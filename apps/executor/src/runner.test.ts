import { describe, expect, test } from 'bun:test';
import type { ExecutionJob } from '@webperf/contracts';
import { ExecutorApiError, type ExecutorLeaseClient } from './client';
import { processExecutionJob, runExecutor, type ExecutorLogger } from './runner';

const queuedJob: ExecutionJob = {
  id: 'exec_runner',
  kind: 'network_probe',
  resourceId: 'job_runner',
  status: 'queued',
  leaseOwner: null,
  leaseExpiresAt: null,
  attemptCount: 0,
  maxAttempts: 3,
  availableAt: '2026-07-22T00:00:00.000Z',
  payload: { jobId: 'job_runner' },
  error: null,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  completedAt: null
};

const runningJob: ExecutionJob = {
  ...queuedJob,
  status: 'running',
  leaseOwner: 'executor-test',
  leaseExpiresAt: '2026-07-22T00:01:00.000Z',
  attemptCount: 1
};

const completedJob: ExecutionJob = {
  ...runningJob,
  status: 'succeeded',
  leaseOwner: null,
  leaseExpiresAt: null,
  completedAt: '2026-07-22T00:00:10.000Z'
};

const logger = (): ExecutorLogger & { events: Array<Record<string, unknown>> } => {
  const events: Array<Record<string, unknown>> = [];
  return {
    events,
    info: (event) => events.push(event),
    error: (event) => events.push(event)
  };
};

describe('executor runner', () => {
  test('renews a lease, completes work, and stops claiming after shutdown', async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const testLogger = logger();
    let claimed = false;
    let resolveRenewed!: () => void;
    const renewed = new Promise<void>((resolve) => {
      resolveRenewed = resolve;
    });
    const client: ExecutorLeaseClient = {
      claim: async () => {
        calls.push('claim');
        if (claimed) return null;
        claimed = true;
        return queuedJob;
      },
      start: async () => {
        calls.push('start');
        return runningJob;
      },
      renew: async () => {
        calls.push('renew');
        resolveRenewed();
        return runningJob;
      },
      complete: async () => {
        calls.push('complete');
        controller.abort();
        return completedJob;
      },
      fail: async () => {
        throw new Error('fail should not be called');
      }
    };

    await runExecutor({
      client,
      handler: async () => {
        calls.push('handle');
        await renewed;
      },
      leaseOwner: 'executor-test',
      leaseDurationMs: 60_000,
      heartbeatIntervalMs: 1,
      maxExecutionMs: 60_000,
      pollIntervalMs: 5,
      signal: controller.signal,
      logger: testLogger
    });

    expect(calls.slice(0, 3)).toEqual(['claim', 'start', 'handle']);
    expect(calls.filter((call) => call === 'claim')).toHaveLength(1);
    expect(calls.filter((call) => call === 'renew').length).toBeGreaterThan(0);
    expect(calls.at(-1)).toBe('complete');
    expect(testLogger.events.at(-1)?.event).toBe('execution_completed');
  });

  test('aborts active work and requeues it when shutdown is requested', async () => {
    const controller = new AbortController();
    const testLogger = logger();
    let handlerAborted = false;
    let failureCode: string | undefined;
    const client: ExecutorLeaseClient = {
      claim: async () => queuedJob,
      start: async () => runningJob,
      renew: async () => runningJob,
      complete: async () => {
        throw new Error('complete should not be called');
      },
      fail: async (_id, input) => {
        failureCode = input.error.code;
        return {
          ...runningJob,
          status: 'queued',
          leaseOwner: null,
          leaseExpiresAt: null,
          availableAt: '2026-07-22T00:00:05.000Z',
          error: input.error
        };
      }
    };

    await runExecutor({
      client,
      handler: async (_job, signal) => {
        controller.abort();
        handlerAborted = signal.aborted;
        throw signal.reason;
      },
      leaseOwner: 'executor-test',
      leaseDurationMs: 60_000,
      heartbeatIntervalMs: 1_000,
      maxExecutionMs: 60_000,
      pollIntervalMs: 5,
      signal: controller.signal,
      logger: testLogger
    });

    expect(handlerAborted).toBe(true);
    expect(failureCode).toBe('executor_shutdown');
    expect(testLogger.events).toContainEqual(expect.objectContaining({
      event: 'execution_failed',
      code: 'executor_shutdown',
      retryable: true
    }));
  });

  test('never persists or logs an unknown handler error message', async () => {
    const controller = new AbortController();
    const testLogger = logger();
    let persistedMessage: string | undefined;
    const client: ExecutorLeaseClient = {
      claim: async () => queuedJob,
      start: async () => runningJob,
      renew: async () => runningJob,
      complete: async () => completedJob,
      fail: async (_id, input) => {
        persistedMessage = input.error.message;
        controller.abort();
        return {
          ...runningJob,
          status: 'queued',
          leaseOwner: null,
          leaseExpiresAt: null,
          availableAt: '2026-07-22T00:00:05.000Z',
          error: input.error
        };
      }
    };

    await runExecutor({
      client,
      handler: async () => {
        throw new Error('Bearer raw-sensitive-handler-error');
      },
      leaseOwner: 'executor-test',
      leaseDurationMs: 60_000,
      heartbeatIntervalMs: 5,
      maxExecutionMs: 60_000,
      pollIntervalMs: 5,
      signal: controller.signal,
      logger: testLogger
    });

    expect(persistedMessage).toBe('Execution handler failed');
    expect(JSON.stringify(testLogger.events)).not.toContain('raw-sensitive-handler-error');
  });

  test('does not fail a job after completion is rejected for a stale lease', async () => {
    const testLogger = logger();
    let failCalled = false;
    const client: ExecutorLeaseClient = {
      claim: async () => null,
      start: async () => runningJob,
      renew: async () => runningJob,
      complete: async () => {
        throw new ExecutorApiError('stale lease', 409);
      },
      fail: async () => {
        failCalled = true;
        return runningJob;
      }
    };

    await processExecutionJob({
      client,
      handler: async () => {},
      executionJob: queuedJob,
      lease: { leaseOwner: 'executor-test', leaseDurationMs: 60_000 },
      heartbeatIntervalMs: 1_000,
      maxExecutionMs: 60_000,
      logger: testLogger
    });

    expect(failCalled).toBe(false);
    expect(testLogger.events.at(-1)).toMatchObject({
      event: 'execution_completion_rejected',
      reason: 'lease_lost'
    });
  });

  test('records a retryable failure when a leased job cannot start', async () => {
    const testLogger = logger();
    let handlerCalled = false;
    let recordedFailure: { code: string; retryable: boolean } | null = null;
    const client: ExecutorLeaseClient = {
      claim: async () => null,
      start: async () => {
        throw Object.assign(new Error('start transport failed'), { code: 'ECONNRESET' });
      },
      renew: async () => runningJob,
      complete: async () => completedJob,
      fail: async (_id, input) => {
        recordedFailure = input.error;
        return {
          ...runningJob,
          status: 'queued',
          leaseOwner: null,
          leaseExpiresAt: null,
          error: input.error
        };
      }
    };

    await processExecutionJob({
      client,
      handler: async () => {
        handlerCalled = true;
      },
      executionJob: queuedJob,
      lease: { leaseOwner: 'executor-test', leaseDurationMs: 60_000 },
      heartbeatIntervalMs: 1_000,
      maxExecutionMs: 60_000,
      logger: testLogger
    });

    expect(handlerCalled).toBe(false);
    expect(recordedFailure).toMatchObject({
      code: 'execution_start_failed',
      retryable: true
    });
    expect(testLogger.events).toContainEqual(expect.objectContaining({
      event: 'execution_start_failure_recorded',
      status: 'queued'
    }));
  });

  test('bounds cleanup when an in-flight heartbeat ignores abort', async () => {
    const testLogger = logger();
    let notifyRenewStarted!: () => void;
    const renewStarted = new Promise<void>((resolve) => {
      notifyRenewStarted = resolve;
    });
    const client: ExecutorLeaseClient = {
      claim: async () => null,
      start: async () => runningJob,
      renew: async () => {
        notifyRenewStarted();
        return await new Promise<ExecutionJob>(() => undefined);
      },
      complete: async () => completedJob,
      fail: async () => runningJob
    };

    await processExecutionJob({
      client,
      handler: async () => {
        await renewStarted;
      },
      executionJob: queuedJob,
      lease: { leaseOwner: 'executor-test', leaseDurationMs: 60_000 },
      heartbeatIntervalMs: 1,
      heartbeatShutdownTimeoutMs: 10,
      maxExecutionMs: 60_000,
      logger: testLogger
    });

    expect(testLogger.events).toContainEqual(expect.objectContaining({
      event: 'heartbeat_shutdown_timeout',
      timeoutMs: 10
    }));
  });

  test('retries a transient lease renewal failure before the local deadline', async () => {
    const testLogger = logger();
    let renewCalls = 0;
    let completed = false;
    let failed = false;
    let notifyRenewed!: () => void;
    const renewed = new Promise<void>((resolve) => {
      notifyRenewed = resolve;
    });
    const client: ExecutorLeaseClient = {
      claim: async () => null,
      start: async () => runningJob,
      renew: async () => {
        renewCalls += 1;
        if (renewCalls === 1) {
          throw new ExecutorApiError('temporary service failure', 503);
        }
        notifyRenewed();
        return runningJob;
      },
      complete: async () => {
        completed = true;
        return completedJob;
      },
      fail: async () => {
        failed = true;
        return runningJob;
      }
    };

    await processExecutionJob({
      client,
      handler: async () => await renewed,
      executionJob: queuedJob,
      lease: { leaseOwner: 'executor-test', leaseDurationMs: 60_000 },
      heartbeatIntervalMs: 1,
      maxExecutionMs: 60_000,
      logger: testLogger,
      now: () => 1_000
    });

    expect(renewCalls).toBe(2);
    expect(completed).toBe(true);
    expect(failed).toBe(false);
    expect(testLogger.events).toContainEqual(expect.objectContaining({
      event: 'execution_lease_renew_retry',
      retryInMs: 1,
      status: 503
    }));
  });

  test('aborts work when transient renewal failures consume the local lease deadline', async () => {
    const testLogger = logger();
    let nowMs = 0;
    let failureCode: string | undefined;
    let renewCalls = 0;
    const client: ExecutorLeaseClient = {
      claim: async () => null,
      start: async () => runningJob,
      renew: async () => {
        renewCalls += 1;
        throw new ExecutorApiError('temporary network failure', null);
      },
      complete: async () => {
        throw new Error('complete should not be called');
      },
      fail: async (_id, input) => {
        failureCode = input.error.code;
        return { ...runningJob, status: 'queued', leaseOwner: null, leaseExpiresAt: null };
      }
    };

    await processExecutionJob({
      client,
      handler: async (_job, signal) => await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
      executionJob: queuedJob,
      lease: { leaseOwner: 'executor-test', leaseDurationMs: 5 },
      heartbeatIntervalMs: 1,
      maxExecutionMs: 60_000,
      logger: testLogger,
      now: () => {
        nowMs += 2;
        return nowMs;
      }
    });

    expect(renewCalls).toBe(1);
    expect(failureCode).toBe('lease_lost');
    expect(testLogger.events).toContainEqual(expect.objectContaining({
      event: 'execution_lease_lost',
      errorType: 'ExecutionFailure'
    }));
  });

  test('aborts and retries a handler that exceeds its execution limit', async () => {
    const testLogger = logger();
    let aborted = false;
    let failureCode: string | undefined;
    const client: ExecutorLeaseClient = {
      claim: async () => null,
      start: async () => runningJob,
      renew: async () => runningJob,
      complete: async () => completedJob,
      fail: async (_id, input) => {
        failureCode = input.error.code;
        return {
          ...runningJob,
          status: 'queued',
          leaseOwner: null,
          leaseExpiresAt: null,
          availableAt: '2026-07-22T00:00:05.000Z',
          error: input.error
        };
      }
    };

    await processExecutionJob({
      client,
      handler: async (_job, signal) => {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            const error = new Error('Bearer raw-sensitive-abort-error');
            error.name = 'AbortError';
            reject(error);
          });
        });
      },
      executionJob: queuedJob,
      lease: { leaseOwner: 'executor-test', leaseDurationMs: 60_000 },
      heartbeatIntervalMs: 1_000,
      maxExecutionMs: 10,
      logger: testLogger
    });

    expect(aborted).toBe(true);
    expect(failureCode).toBe('execution_timeout');
    expect(testLogger.events).toContainEqual(expect.objectContaining({
      event: 'handler_error_after_abort',
      errorType: 'AbortError'
    }));
    expect(JSON.stringify(testLogger.events)).not.toContain('raw-sensitive-abort-error');
  });

  test('backs off claim failures with safe diagnostics', async () => {
    const controller = new AbortController();
    const testLogger = logger();
    let claimCount = 0;
    const client: ExecutorLeaseClient = {
      claim: async () => {
        claimCount += 1;
        if (claimCount === 1) {
          const error = Object.assign(new Error('connect failed for secret host'), {
            code: 'ECONNREFUSED'
          });
          error.name = 'Bearer raw-sensitive-error-type';
          throw error;
        }
        controller.abort();
        return null;
      },
      start: async () => runningJob,
      renew: async () => runningJob,
      complete: async () => completedJob,
      fail: async () => runningJob
    };

    await runExecutor({
      client,
      handler: async () => {},
      leaseOwner: 'executor-test',
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 10,
      maxExecutionMs: 1_000,
      pollIntervalMs: 1,
      signal: controller.signal,
      logger: testLogger,
      random: () => 0
    });

    expect(claimCount).toBe(2);
    expect(testLogger.events[0]).toMatchObject({
      event: 'claim_failed',
      retryInMs: 1,
      systemCode: 'ECONNREFUSED'
    });
    expect(JSON.stringify(testLogger.events)).not.toContain('secret host');
    expect(JSON.stringify(testLogger.events)).not.toContain('raw-sensitive-error-type');
  });
});
