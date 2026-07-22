import type { ExecutionJob, ExecutionJobError } from '@webperf/contracts';
import type { ExecutorApiClient } from './client';

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
  pollIntervalMs,
  signal,
  logger = consoleExecutorLogger
}: {
  client: ExecutorApiClient;
  handler: ExecutionHandler;
  leaseOwner: string;
  leaseDurationMs: number;
  heartbeatIntervalMs: number;
  pollIntervalMs: number;
  signal: AbortSignal;
  logger?: ExecutorLogger;
}) => {
  validateExecutorLoopOptions({
    leaseOwner,
    leaseDurationMs,
    heartbeatIntervalMs,
    pollIntervalMs
  });
  const lease = { leaseOwner, leaseDurationMs };

  while (!signal.aborted) {
    let executionJob: ExecutionJob | null;

    try {
      executionJob = await client.claim(lease);
    } catch {
      logger.error({ event: 'claim_failed' });
      await waitForNextPoll(pollIntervalMs, signal);
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
  logger
}: {
  client: ExecutorApiClient;
  handler: ExecutionHandler;
  executionJob: ExecutionJob;
  lease: { leaseOwner: string; leaseDurationMs: number };
  heartbeatIntervalMs: number;
  logger: ExecutorLogger;
}) => {
  let running: ExecutionJob;

  try {
    running = await client.start(executionJob.id, lease);
  } catch {
    logger.error({
      event: 'execution_start_failed',
      executionJobId: executionJob.id,
      kind: executionJob.kind
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
    onLeaseLost: () => workController.abort()
  });

  try {
    await handler(running, workController.signal);

    if (workController.signal.aborted) {
      throw new ExecutionFailure(
        'lease_lost',
        'Execution lease was lost before completion',
        true,
        1_000
      );
    }

    const completed = await client.complete(running.id, { leaseOwner: lease.leaseOwner });
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
    } catch {
      logger.error({
        event: 'execution_failure_persist_failed',
        executionJobId: running.id,
        kind: running.kind,
        code: failure.error.code
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
  onLeaseLost: () => void;
}) => {
  while (!stopSignal.aborted) {
    const shouldContinue = await waitForNextPoll(heartbeatIntervalMs, stopSignal);

    if (!shouldContinue) {
      return;
    }

    try {
      await client.renew(executionJob.id, lease);
    } catch {
      onLeaseLost();
      return;
    }
  }
};

const normalizeExecutionFailure = (error: unknown): {
  error: ExecutionJobError;
  retryDelayMs?: number;
} => {
  if (error instanceof ExecutionFailure) {
    return {
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable
      },
      retryDelayMs: error.retryDelayMs
    };
  }

  return {
    error: {
      code: 'execution_failed',
      message: 'Execution handler failed',
      retryable: true
    }
  };
};

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
  pollIntervalMs
}: {
  leaseOwner: string;
  leaseDurationMs: number;
  heartbeatIntervalMs: number;
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
};

const consoleExecutorLogger: ExecutorLogger = {
  info: (event) => console.log(JSON.stringify({ service: 'webperf-executor', level: 'info', ...event })),
  error: (event) => console.error(JSON.stringify({ service: 'webperf-executor', level: 'error', ...event }))
};
