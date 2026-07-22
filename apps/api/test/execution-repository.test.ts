import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteJobRepository } from '../src/repository';

const tempDirs: string[] = [];
const encryptionSecret = 'execution-repository-test-secret';

const createTempDatabasePath = () => {
  const directory = mkdtempSync(join(tmpdir(), 'webperf-execution-'));
  tempDirs.push(directory);
  return join(directory, 'webperf.sqlite');
};

const createRepository = (databasePath: string) =>
  createSqliteJobRepository({ databasePath, encryptionSecret });

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();

    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe('durable execution repository', () => {
  test('encrypts queue payloads and atomically owns a lease through completion', () => {
    const databasePath = createTempDatabasePath();
    const first = createRepository(databasePath);
    const second = createRepository(databasePath);
    const queuedAt = new Date('2026-07-22T00:00:00.000Z');
    const payloadSecret = 'Bearer must-not-appear-in-execution-table';

    const queued = first.enqueueExecutionJob(
      {
        id: 'exec_network_1',
        kind: 'network_probe',
        resourceId: 'job_1',
        maxAttempts: 3,
        payload: { authorization: payloadSecret, jobId: 'job_1' }
      },
      queuedAt
    );
    expect(queued.status).toBe('queued');
    expect(queued.attemptCount).toBe(0);

    const database = new Database(databasePath, { readonly: true });
    const raw = database
      .query<{ payload_json: string; error_json: string | null }, []>(
        'SELECT payload_json, error_json FROM execution_jobs WHERE id = "exec_network_1"'
      )
      .get();
    expect(raw?.payload_json.startsWith('webperf:enc:v2:')).toBe(true);
    expect(raw?.payload_json).not.toContain(payloadSecret);
    expect(raw?.error_json).toBeNull();
    database.close();

    const leased = first.claimExecutionJob(
      { leaseOwner: 'executor-a', leaseDurationMs: 10_000 },
      queuedAt
    );
    expect(leased?.status).toBe('leased');
    expect(leased?.attemptCount).toBe(1);
    expect(
      second.claimExecutionJob(
        { leaseOwner: 'executor-b', leaseDurationMs: 10_000 },
        queuedAt
      )
    ).toBeNull();

    const runningAt = new Date('2026-07-22T00:00:01.000Z');
    const running = first.markExecutionJobRunning(
      {
        id: 'exec_network_1',
        leaseOwner: 'executor-a',
        leaseDurationMs: 10_000
      },
      runningAt
    );
    expect(running?.status).toBe('running');
    expect(
      second.renewExecutionJobLease(
        {
          id: 'exec_network_1',
          leaseOwner: 'executor-b',
          leaseDurationMs: 10_000
        },
        runningAt
      )
    ).toBeNull();

    const completedAt = new Date('2026-07-22T00:00:02.000Z');
    const completed = first.completeExecutionJob(
      { id: 'exec_network_1', leaseOwner: 'executor-a' },
      completedAt
    );
    expect(completed?.status).toBe('succeeded');
    expect(completed?.completedAt).toBe(completedAt.toISOString());
    expect(
      first.completeExecutionJob(
        { id: 'exec_network_1', leaseOwner: 'executor-a' },
        completedAt
      )?.status
    ).toBe('succeeded');

    first.close();
    second.close();
  });

  test('recovers expired work and terminally fails at the lease-attempt limit', () => {
    const databasePath = createTempDatabasePath();
    const repository = createRepository(databasePath);
    const queuedAt = new Date('2026-07-22T00:00:00.000Z');

    repository.enqueueExecutionJob(
      {
        id: 'exec_recover',
        kind: 'network_probe',
        resourceId: 'job_recover',
        maxAttempts: 2,
        payload: { jobId: 'job_recover' }
      },
      queuedAt
    );
    repository.claimExecutionJob(
      { leaseOwner: 'executor-a', leaseDurationMs: 1_000 },
      queuedAt
    );

    const recovered = repository.claimExecutionJob(
      { leaseOwner: 'executor-b', leaseDurationMs: 1_000 },
      new Date('2026-07-22T00:00:02.000Z')
    );
    expect(recovered?.id).toBe('exec_recover');
    expect(recovered?.attemptCount).toBe(2);
    expect(recovered?.leaseOwner).toBe('executor-b');

    expect(
      repository.claimExecutionJob(
        { leaseOwner: 'executor-c', leaseDurationMs: 1_000 },
        new Date('2026-07-22T00:00:04.000Z')
      )
    ).toBeNull();
    const failed = repository.getExecutionJob('exec_recover');
    expect(failed?.status).toBe('failed');
    expect(failed?.error?.code).toBe('lease_attempts_exhausted');
    expect(failed?.completedAt).toBe('2026-07-22T00:00:04.000Z');

    repository.close();
  });

  test('schedules retryable failures and rejects a stale owner', () => {
    const databasePath = createTempDatabasePath();
    const repository = createRepository(databasePath);
    const queuedAt = new Date('2026-07-22T00:00:00.000Z');

    repository.enqueueExecutionJob(
      {
        id: 'exec_retry',
        kind: 'browser_audit',
        resourceId: 'audit_retry',
        maxAttempts: 3,
        payload: { auditId: 'audit_retry' }
      },
      queuedAt
    );
    repository.claimExecutionJob(
      { leaseOwner: 'executor-a', leaseDurationMs: 10_000 },
      queuedAt
    );

    const retried = repository.failExecutionJob(
      {
        id: 'exec_retry',
        leaseOwner: 'executor-a',
        retryDelayMs: 5_000,
        error: {
          code: 'runner_unavailable',
          message: 'Browser runner is temporarily unavailable',
          retryable: true
        }
      },
      new Date('2026-07-22T00:00:01.000Z')
    );
    expect(retried?.status).toBe('queued');
    expect(retried?.availableAt).toBe('2026-07-22T00:00:06.000Z');
    const database = new Database(databasePath, { readonly: true });
    const rawError = database
      .query<{ error_json: string | null }, []>(
        'SELECT error_json FROM execution_jobs WHERE id = "exec_retry"'
      )
      .get()?.error_json;
    expect(rawError?.startsWith('webperf:enc:v2:')).toBe(true);
    expect(rawError).not.toContain('Browser runner is temporarily unavailable');
    database.close();
    expect(
      repository.claimExecutionJob(
        { leaseOwner: 'executor-b', leaseDurationMs: 10_000 },
        new Date('2026-07-22T00:00:05.999Z')
      )
    ).toBeNull();

    const leased = repository.claimExecutionJob(
      { leaseOwner: 'executor-b', leaseDurationMs: 10_000 },
      new Date('2026-07-22T00:00:06.000Z')
    );
    expect(leased?.attemptCount).toBe(2);
    expect(
      repository.completeExecutionJob(
        { id: 'exec_retry', leaseOwner: 'executor-a' },
        new Date('2026-07-22T00:00:07.000Z')
      )
    ).toBeNull();

    const cancelled = repository.cancelExecutionJob(
      'exec_retry',
      new Date('2026-07-22T00:00:08.000Z')
    );
    expect(cancelled?.status).toBe('cancelled');
    expect(
      repository.cancelExecutionJob(
        'exec_retry',
        new Date('2026-07-22T00:00:09.000Z')
      )?.status
    ).toBe('cancelled');

    repository.close();
  });

  test('keeps an execution id bound to its original resource', () => {
    const databasePath = createTempDatabasePath();
    const repository = createRepository(databasePath);

    repository.enqueueExecutionJob({
      id: 'exec_idempotent',
      kind: 'webhook_delivery',
      resourceId: 'delivery_1',
      maxAttempts: 2,
      payload: { deliveryId: 'delivery_1' }
    });
    expect(
      repository.enqueueExecutionJob({
        id: 'exec_idempotent',
        kind: 'webhook_delivery',
        resourceId: 'delivery_1',
        maxAttempts: 2,
        payload: { deliveryId: 'delivery_1' }
      }).id
    ).toBe('exec_idempotent');
    expect(() =>
      repository.enqueueExecutionJob({
        id: 'exec_idempotent',
        kind: 'browser_audit',
        resourceId: 'audit_2',
        maxAttempts: 2,
        payload: { auditId: 'audit_2' }
      })
    ).toThrow('Execution job id already belongs to a different resource');

    repository.close();
  });

  test('skips corrupted rows without crashing queue reads', () => {
    const databasePath = createTempDatabasePath();
    const repository = createRepository(databasePath);
    repository.enqueueExecutionJob(
      {
        id: 'exec_corrupt',
        kind: 'network_probe',
        resourceId: 'job_corrupt',
        maxAttempts: 2,
        payload: { jobId: 'job_corrupt' }
      },
      new Date('2026-07-22T00:00:00.000Z')
    );
    repository.enqueueExecutionJob(
      {
        id: 'exec_valid',
        kind: 'network_probe',
        resourceId: 'job_valid',
        maxAttempts: 2,
        payload: { jobId: 'job_valid' }
      },
      new Date('2026-07-22T00:00:01.000Z')
    );

    const database = new Database(databasePath);
    database
      .query('UPDATE execution_jobs SET payload_json = ? WHERE id = ?')
      .run('{"jobId":"unencrypted"}', 'exec_corrupt');
    database.close();

    expect(repository.getExecutionJob('exec_corrupt')).toBeNull();
    expect(repository.listExecutionJobs().map((job) => job.id)).toEqual(['exec_valid']);
    expect(
      repository.claimExecutionJob(
        { leaseOwner: 'executor-a', leaseDurationMs: 10_000 },
        new Date('2026-07-22T00:00:02.000Z')
      )
    ).toBeNull();
    expect(
      repository.claimExecutionJob(
        { leaseOwner: 'executor-a', leaseDurationMs: 10_000 },
        new Date('2026-07-22T00:00:02.000Z')
      )?.id
    ).toBe('exec_valid');

    repository.close();
  });
});
