import { describe, expect, test } from 'bun:test';
import type { ExecutionJob } from '@webperf/contracts';
import type { ExecutorApiClient } from './client';
import { runExecutor, type ExecutorLogger } from './runner';

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
  test('renews a lease, finishes active work, and stops claiming after shutdown', async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const testLogger = logger();
    let claimed = false;
    let resolveRenewed!: () => void;
    const renewed = new Promise<void>((resolve) => {
      resolveRenewed = resolve;
    });
    const client: ExecutorApiClient = {
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
        controller.abort();
        await renewed;
      },
      leaseOwner: 'executor-test',
      leaseDurationMs: 60_000,
      heartbeatIntervalMs: 1,
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

  test('never persists or logs an unknown handler error message', async () => {
    const controller = new AbortController();
    const testLogger = logger();
    let persistedMessage: string | undefined;
    const client: ExecutorApiClient = {
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
      pollIntervalMs: 5,
      signal: controller.signal,
      logger: testLogger
    });

    expect(persistedMessage).toBe('Execution handler failed');
    expect(JSON.stringify(testLogger.events)).not.toContain('raw-sensitive-handler-error');
  });
});
