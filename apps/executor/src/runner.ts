import type { ExecutionJob, ExecutionJobError } from '@webperf/contracts';
import { ExecutorApiError, type ExecutorLeaseClient } from './client';
import { describeSafeError } from './diagnostics';

export type ExecutionHandler = (job: ExecutionJob, signal: AbortSignal) => Promise<void>;

export type ExecutorLogger = {
  info(event: Record<string, unknown>): void;
  error(event: Record<string, unknown>): void;
};

export class ExecutionFailure extends Error {
  override readonly name: string = 'ExecutionFailure';

  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly retryDelayMs?: number
  ) {
    super(message);
  }
}

export const runExecutor = async ({
  client,
  handler,
  leaseOwner,
  leaseDurationMs,
  heartbeatIntervalMs,
  maxExecutionMs,
  pollIntervalMs,
  signal,
  logger = consoleExecutorLogger,
  random = Math.random
}: {
  client: ExecutorLeaseClient;
  handler: ExecutionHandler;
  leaseOwner: string;
  leaseDurationMs: number;
  heartbeatIntervalMs: number;
  maxExecutionMs: number;
  pollIntervalMs: number;
  signal: AbortSignal;
  logger?: ExecutorLogger;
  random?: () => number;
}) => {
  validateExecutorLoopOptions({
    leaseOwner,
    leaseDurationMs,
    heartbeatIntervalMs,
    maxExecutionMs,
    pollIntervalMs
  });
  const lease = { leaseOwner, leaseDurationMs };
  let consecutiveClaimFailures = 0;

  while (!signal.aborted) {
    let executionJob: ExecutionJob | null;

    try {
      executionJob = await client.claim(lease);
      consecutiveClaimFailures = 0;
    } catch (error) {
      consecutiveClaimFailures += 1;
      const backoffMs = calculateClaimBackoff(
        pollIntervalMs,
        consecutiveClaimFailures,
        random
      );
      logger.error({
        event: 'claim_failed',
        consecutiveFailures: consecutiveClaimFailures,
        retryInMs: backoffMs,
        ...describeSafeError(error)
      });
      await waitForNextPoll(backoffMs, signal);
      continue;
    }

    if (!executionJob) {
      await waitForNextPoll(pollIntervalMs, signal);
      continue;
    }

    await processExecutionJob({
      client,
      handler,
      executionJob,
      lease,
      heartbeatIntervalMs,
      maxExecutionMs,
      logger,
      shutdownSignal: signal
    });
  }
};

export const processExecutionJob = async ({
  client,
  handler,
  executionJob,
  lease,
  heartbeatIntervalMs,
  maxExecutionMs,
  logger,
  shutdownSignal
}: {
  client: ExecutorLeaseClient;
  handler: ExecutionHandler;
  executionJob: ExecutionJob;
  lease: { leaseOwner: string; leaseDurationMs: number };
  heartbeatIntervalMs: number;
  maxExecutionMs: number;
  logger: ExecutorLogger;
  shutdownSignal?: AbortSignal;
}) => {
  let running: ExecutionJob;

  try {
    running = await client.start(executionJob.id, lease);
  } catch (error) {
    logger.error({
      event: 'execution_start_failed',
      executionJobId: executionJob.id,
      kind: executionJob.kind,
      ...describeSafeError(error)
    });
    return;
  }

  const heartbeatController = new AbortController();
  const workController = new AbortController();
  const onShutdown = () => {
    workController.abort(createShutdownFailure());
  };

  if (shutdownSignal?.aborted) {
    onShutdown();
  } else {
    shutdownSignal?.addEventListener('abort', onShutdown, { once: true });
  }
  const heartbeat = renewLeaseUntilStopped({
    client,
    executionJob: running,
    lease,
    heartbeatIntervalMs,
    stopSignal: heartbeatController.signal,
    onLeaseLost: (error) => {
      logger.error({
        event: 'execution_lease_lost',
        executionJobId: running.id,
        kind: running.kind,
        ...describeSafeError(error)
      });
      workController.abort(createLeaseLostFailure());
    }
  });

  try {
    await runHandlerWithTimeout({
      handler,
      executionJob: running,
      workController,
      maxExecutionMs,
      logger
    });

    if (workController.signal.aborted) {
      throw readWorkAbortFailure(workController.signal);
    }

    let completed: ExecutionJob;

    try {
      completed = await client.complete(running.id, { leaseOwner: lease.leaseOwner });
    } catch (error) {
      if (error instanceof ExecutorApiError && error.status === 409) {
        logger.error({
          event: 'execution_completion_rejected',
          executionJobId: running.id,
          kind: running.kind,
          reason: 'lease_lost'
        });
        return;
      }

      throw error;
    }
    logger.info({
      event: 'execution_completed',
      executionJobId: completed.id,
      kind: completed.kind,
      attemptCount: completed.attemptCount
    });
  } catch (error) {
    const failure = normalizeExecutionFailure(error);

    try {
      const failed = await client.fail(running.id, {
        leaseOwner: lease.leaseOwner,
        error: failure.error,
        retryDelayMs: failure.retryDelayMs
      });
      logger.error({
        event: 'execution_failed',
        executionJobId: failed.id,
        kind: failed.kind,
        code: failure.error.code,
        retryable: failure.error.retryable,
        status: failed.status
      });
    } catch (persistError) {
      logger.error({
        event: 'execution_failure_persist_failed',
        executionJobId: running.id,
        kind: running.kind,
        code: failure.error.code,
        ...describeSafeError(persistError)
      });
    }
  } finally {
    shutdownSignal?.removeEventListener('abort', onShutdown);
    heartbeatController.abort();
    await heartbeat;
  }
};

const renewLeaseUntilStopped = async ({
  client,
  executionJob,
  lease,
  heartbeatIntervalMs,
  stopSignal,
  onLeaseLost
}: {
  client: ExecutorLeaseClient;
  executionJob: ExecutionJob;
  lease: { leaseOwner: string; leaseDurationMs: number };
  heartbeatIntervalMs: number;
  stopSignal: AbortSignal;
  onLeaseLost: (error: unknown) => void;
}) => {
  while (!stopSignal.aborted) {
    const shouldContinue = await waitForNextPoll(heartbeatIntervalMs, stopSignal);

    if (!shouldContinue) {
      return;
    }

    try {
      await client.renew(executionJob.id, lease);
    } catch (error) {
      onLeaseLost(error);
      return;
    }
  }
};

const normalizeExecutionFailure = (error: unknown): {
  error: ExecutionJobError;
  retryDelayMs?: number;
} => {
  if (error instanceof ExecutionFailure) {
    const code = /^[A-Za-z0-9_:-]{1,120}$/.test(error.code)
      ? error.code
      : 'execution_failed';
    const message = error.message.trim().slice(0, 1_000) || 'Execution handler failed';
    return {
      error: {
        code,
        message,
        retryable: error.retryable
      },
      retryDelayMs: normalizeRetryDelay(error.retryDelayMs)
    };
  }

  const diagnostic = describeSafeError(error);
  const systemCode = typeof diagnostic.systemCode === 'string'
    ? diagnostic.systemCode
    : null;

  return {
    error: {
      code: systemCode ? `execution_${systemCode.toLowerCase()}` : 'execution_failed',
      message: systemCode
        ? `Execution handler failed (${systemCode})`
        : 'Execution handler failed',
      retryable: true
    }
  };
};

const runHandlerWithTimeout = async ({
  handler,
  executionJob,
  workController,
  maxExecutionMs,
  logger
}: {
  handler: ExecutionHandler;
  executionJob: ExecutionJob;
  workController: AbortController;
  maxExecutionMs: number;
  logger: ExecutorLogger;
}) => {
  let onWorkAborted: (() => void) | undefined;
  const workAborted = new Promise<never>((_resolve, reject) => {
    onWorkAborted = () => {
      reject(readWorkAbortFailure(workController.signal));
    };

    if (workController.signal.aborted) {
      onWorkAborted();
      return;
    }

    workController.signal.addEventListener('abort', onWorkAborted, { once: true });
  });

  const handlerCompleted = Promise.resolve()
    .then(() => handler(executionJob, workController.signal))
    .catch((error) => {
      if (workController.signal.aborted) {
        logger.error({
          event: 'handler_error_after_abort',
          executionJobId: executionJob.id,
          kind: executionJob.kind,
          ...describeSafeError(error)
        });
        throw readWorkAbortFailure(workController.signal);
      }

      throw error;
    });
  const timeout = setTimeout(() => {
    workController.abort(
      new ExecutionFailure(
        'execution_timeout',
        'Execution exceeded the configured time limit',
        true,
        1_000
      )
    );
  }, maxExecutionMs);

  try {
    await Promise.race([
      handlerCompleted,
      workAborted
    ]);
  } finally {
    clearTimeout(timeout);
    if (onWorkAborted) {
      workController.signal.removeEventListener('abort', onWorkAborted);
    }
  }
};

const createLeaseLostFailure = () => new ExecutionFailure(
  'lease_lost',
  'Execution lease was lost before completion',
  true,
  1_000
);

const createShutdownFailure = () => new ExecutionFailure(
  'executor_shutdown',
  'Executor shutdown interrupted active work',
  true,
  1_000
);

const readWorkAbortFailure = (signal: AbortSignal) =>
  signal.reason instanceof ExecutionFailure ? signal.reason : createLeaseLostFailure();

const calculateClaimBackoff = (
  pollIntervalMs: number,
  consecutiveFailures: number,
  random: () => number
) => {
  const exponential = Math.min(
    pollIntervalMs * 2 ** Math.min(consecutiveFailures - 1, 8),
    60_000
  );
  const randomValue = random();
  const boundedRandom = Number.isFinite(randomValue)
    ? Math.min(1, Math.max(0, randomValue))
    : 0;
  const minimum = Math.max(pollIntervalMs, Math.floor(exponential * 0.9));
  const maximum = Math.min(60_000, Math.ceil(exponential * 1.1));
  return Math.round(minimum + (maximum - minimum) * boundedRandom);
};

const normalizeRetryDelay = (value: number | undefined) =>
  value != null && Number.isSafeInteger(value) && value >= 0 && value <= 86_400_000
    ? value
    : undefined;

const waitForNextPoll = (durationMs: number, signal: AbortSignal) =>
  new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }

    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, durationMs);
    const onAbort = () => {
      clearTimeout(timeout);
      resolve(false);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

const validateExecutorLoopOptions = ({
  leaseOwner,
  leaseDurationMs,
  heartbeatIntervalMs,
  maxExecutionMs,
  pollIntervalMs
}: {
  leaseOwner: string;
  leaseDurationMs: number;
  heartbeatIntervalMs: number;
  maxExecutionMs: number;
  pollIntervalMs: number;
}) => {
  if (leaseOwner.length < 1 || leaseOwner.length > 160) {
    throw new Error('Executor lease owner must contain between 1 and 160 characters');
  }

  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1_000 || leaseDurationMs > 3_600_000) {
    throw new Error('Executor lease duration must be an integer between 1000 and 3600000ms');
  }

  if (
    !Number.isSafeInteger(heartbeatIntervalMs)
    || heartbeatIntervalMs < 1
    || heartbeatIntervalMs * 2 >= leaseDurationMs
  ) {
    throw new Error('Executor heartbeat interval must be less than half the lease duration');
  }

  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1 || pollIntervalMs > 60_000) {
    throw new Error('Executor poll interval must be an integer between 1 and 60000ms');
  }

  if (!Number.isSafeInteger(maxExecutionMs) || maxExecutionMs < 1_000 || maxExecutionMs > 86_400_000) {
    throw new Error('Executor max execution time must be an integer between 1000 and 86400000ms');
  }
};

const consoleExecutorLogger: ExecutorLogger = {
  info: (event) => console.log(JSON.stringify({ service: 'webperf-executor', level: 'info', ...event })),
  error: (event) => console.error(JSON.stringify({ service: 'webperf-executor', level: 'error', ...event }))
};
