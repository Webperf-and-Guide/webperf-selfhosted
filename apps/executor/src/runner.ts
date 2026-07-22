import type { ExecutionJob, ExecutionJobError } from '@webperf/contracts';
import { ExecutorApiError, type ExecutorApiClient } from './client';

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
  client: ExecutorApiClient;
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
        ...describeError(error)
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
      logger
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
  logger
}: {
  client: ExecutorApiClient;
  handler: ExecutionHandler;
  executionJob: ExecutionJob;
  lease: { leaseOwner: string; leaseDurationMs: number };
  heartbeatIntervalMs: number;
  maxExecutionMs: number;
  logger: ExecutorLogger;
}) => {
  let running: ExecutionJob;

  try {
    running = await client.start(executionJob.id, lease);
  } catch (error) {
    logger.error({
      event: 'execution_start_failed',
      executionJobId: executionJob.id,
      kind: executionJob.kind,
      ...describeError(error)
    });
    return;
  }

  const heartbeatController = new AbortController();
  const workController = new AbortController();
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
        ...describeError(error)
      });
      workController.abort();
    }
  });

  try {
    await runHandlerWithTimeout({
      handler,
      executionJob: running,
      workController,
      maxExecutionMs
    });

    if (workController.signal.aborted) {
      throw new ExecutionFailure(
        'lease_lost',
        'Execution lease was lost before completion',
        true,
        1_000
      );
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
        ...describeError(persistError)
      });
    }
  } finally {
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
  client: ExecutorApiClient;
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

  const diagnostic = describeError(error);
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
  maxExecutionMs
}: {
  handler: ExecutionHandler;
  executionJob: ExecutionJob;
  workController: AbortController;
  maxExecutionMs: number;
}) => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      workController.abort();
      reject(
        new ExecutionFailure(
          'execution_timeout',
          'Execution exceeded the configured time limit',
          true,
          1_000
        )
      );
    }, maxExecutionMs);
  });

  try {
    await Promise.race([
      handler(executionJob, workController.signal),
      timedOut
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

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
  return Math.min(60_000, exponential + Math.floor(exponential * 0.1 * boundedRandom));
};

const describeError = (error: unknown) => {
  const diagnosticSource = error instanceof ExecutorApiError ? error.cause : error;
  const systemCode = (diagnosticSource as { code?: unknown } | null)?.code;
  const safeSystemCode = typeof systemCode === 'string' && /^[A-Z0-9_]{1,64}$/.test(systemCode)
    ? systemCode
    : undefined;

  if (error instanceof ExecutorApiError) {
    return {
      errorType: error.name,
      ...(error.status === null ? {} : { status: error.status }),
      ...(diagnosticSource instanceof Error
        ? { causeType: normalizeErrorName(diagnosticSource.name) }
        : {}),
      ...(safeSystemCode ? { systemCode: safeSystemCode } : {})
    };
  }

  const errorName = error instanceof Error ? normalizeErrorName(error.name) : 'UnknownError';
  return {
    errorType: errorName,
    ...(safeSystemCode ? { systemCode: safeSystemCode } : {})
  };
};

const normalizeErrorName = (value: string) =>
  /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : 'UnknownError';

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
