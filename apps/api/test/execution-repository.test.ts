import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import type {
  CheckProfileAlertDelivery,
  CheckProfileRun,
  LatencyJobDetail
} from '@webperf/contracts';
import {
  browserAuditResourceSchema,
  executionAvailabilityMaxDelayMs
} from '@webperf/contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSqliteJobRepository,
  executionExhaustionFinalizationBatchSize
} from '../src/repository';
import type { RegionalExecutionRecord } from '../src/regional-runtime-record';

const tempDirs: string[] = [];
const encryptionSecret = 'execution-repository-test-secret';

const createTempDatabasePath = () => {
  const directory = mkdtempSync(join(tmpdir(), 'webperf-execution-'));
  tempDirs.push(directory);
  return join(directory, 'webperf.sqlite');
};

const createRepository = (databasePath: string) =>
  createSqliteJobRepository({ databasePath, encryptionSecret });

const createRun = (alertDeliveries: CheckProfileRun['alertDeliveries'] = []): CheckProfileRun => ({
  id: 'run_lease_result',
  profileId: 'check_lease_result',
  trigger: 'manual',
  createdAt: '2026-07-22T00:00:00.000Z',
  routeCount: 1,
  routes: [{
    routeId: 'route_lease_result',
    routeLabel: 'Home',
    url: 'https://example.com/',
    jobId: 'job_lease_result',
    browserAudit: null
  }],
  browserAuditSummary: null,
  evaluation: null,
  alertDeliveries
});

const createLatencyJob = (id: string): LatencyJobDetail => ({
  id,
  url: 'https://example.com/',
  status: 'queued',
  note: null,
  request: { method: 'GET', headers: [], body: null },
  monitorPolicy: {
    monitorType: 'latency',
    successRule: 'status_2xx_3xx',
    latencyThresholdMs: 500
  },
  requestedAt: '2026-07-22T00:00:00.000Z',
  startedAt: null,
  completedAt: null,
  requesterIp: null,
  region: 'local',
  targets: [{
    jobId: id,
    region: 'local',
    status: 'queued',
    attemptNo: 0,
    maxAttempts: 3,
    latencyMs: null,
    statusCode: null,
    success: null,
    probeImpl: null,
    measurement: null,
    execution: {
      runnerType: 'network_probe',
      provider: 'selfhost',
      locationMode: 'best_effort',
      region: 'tokyo',
      city: null,
      runnerVersion: 'probe-rs'
    },
    slotId: null,
    errorCode: null,
    errorClass: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    updatedAt: '2026-07-22T00:00:00.000Z'
  }],
  evaluation: null,
  summary: { total: 1, succeeded: 0, failed: 0, inflight: 1 }
});

const createDelivery = (targetId: string): CheckProfileAlertDelivery => ({
  targetId,
  targetName: `Hook ${targetId}`,
  url: `https://hooks.example.com/${targetId}`,
  deliveredAt: '2026-07-22T00:00:02.000Z',
  status: 'sent',
  responseStatus: 204,
  error: null
});

const createBrowserAudit = (id: string) => browserAuditResourceSchema.parse({
  id,
  targetUrl: 'https://example.com/',
  region: 'tokyo',
  status: 'queued',
  requestedAt: '2026-07-22T00:00:00.000Z',
  startedAt: null,
  completedAt: null,
  policy: {
    preset: 'mobile',
    flow: { steps: [{ type: 'navigate', url: 'https://example.com/' }] }
  },
  customHeaders: [],
  cookies: [],
  result: null,
  error: null
});

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();

    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe('durable execution repository', () => {
  test('summarizes provider-neutral queue pressure without decrypting payloads', () => {
    const repository = createRepository(createTempDatabasePath());
    const enqueue = (
      id: string,
      kind: 'network_probe' | 'browser_audit' | 'webhook_delivery',
      createdAt: string,
      options: { maxAttempts?: number; availableAt?: string } = {}
    ) => repository.enqueueExecutionJob({
      id,
      kind,
      resourceId: `resource_${id}`,
      maxAttempts: options.maxAttempts ?? 3,
      availableAt: options.availableAt,
      payload: { fixture: id }
    }, new Date(createdAt));

    enqueue('exec_metrics_active', 'network_probe', '2026-07-22T00:00:00.000Z');
    repository.claimExecutionJob(
      { leaseOwner: 'metrics-active', leaseDurationMs: 3_600_000 },
      new Date('2026-07-22T00:00:00.000Z')
    );
    repository.markExecutionJobRunning(
      {
        id: 'exec_metrics_active',
        leaseOwner: 'metrics-active',
        leaseDurationMs: 3_600_000
      },
      new Date('2026-07-22T00:00:01.000Z')
    );
    repository.renewExecutionJobLease(
      {
        id: 'exec_metrics_active',
        leaseOwner: 'metrics-active',
        leaseDurationMs: 3_600_000
      },
      new Date('2026-07-22T00:04:00.000Z')
    );

    enqueue('exec_metrics_expired', 'network_probe', '2026-07-22T00:01:00.000Z');
    repository.claimExecutionJob(
      { leaseOwner: 'metrics-expired', leaseDurationMs: 60_000 },
      new Date('2026-07-22T00:01:00.000Z')
    );

    enqueue(
      'exec_metrics_exhausted',
      'browser_audit',
      '2026-07-22T00:01:10.000Z',
      { maxAttempts: 1 }
    );
    repository.claimExecutionJob(
      { leaseOwner: 'metrics-exhausted', leaseDurationMs: 60_000 },
      new Date('2026-07-22T00:01:10.000Z')
    );

    enqueue('exec_metrics_retry', 'webhook_delivery', '2026-07-22T00:01:20.000Z');
    repository.claimExecutionJob(
      { leaseOwner: 'metrics-retry', leaseDurationMs: 60_000 },
      new Date('2026-07-22T00:01:20.000Z')
    );
    repository.failExecutionJob({
      id: 'exec_metrics_retry',
      leaseOwner: 'metrics-retry',
      error: {
        code: 'retry_fixture',
        message: 'retry fixture',
        retryable: true
      },
      retryDelayMs: 0
    }, new Date('2026-07-22T00:01:21.000Z'));

    enqueue('exec_metrics_ready', 'network_probe', '2026-07-22T00:01:30.000Z');
    enqueue(
      'exec_metrics_delayed',
      'browser_audit',
      '2026-07-22T00:01:40.000Z',
      { availableAt: '2026-07-22T00:10:00.000Z' }
    );

    expect(
      repository.getExecutionQueueMetrics(
        new Date('2026-07-22T00:05:00.000Z'),
        30
      )
    ).toEqual({
      ready: 3,
      delayed: 1,
      active: 1,
      expiredLeases: 2,
      retryQueued: 1,
      exhausted: 1,
      oldestReadyAgeMs: 219_000,
      oldestActiveAgeMs: 300_000,
      byStatus: {
        queued: 3,
        leased: 2,
        running: 1,
        succeeded: 0,
        failed: 0,
        cancelled: 0
      },
      byKind: {
        network_probe: {
          queued: 1,
          leased: 1,
          running: 1,
          succeeded: 0,
          failed: 0,
          cancelled: 0
        },
        browser_audit: {
          queued: 1,
          leased: 1,
          running: 0,
          succeeded: 0,
          failed: 0,
          cancelled: 0
        },
        webhook_delivery: {
          queued: 1,
          leased: 0,
          running: 0,
          succeeded: 0,
          failed: 0,
          cancelled: 0
        }
      }
    });

    repository.close();
  });

  test('bounds terminal execution metric counts by the configured retention window', () => {
    const repository = createRepository(createTempDatabasePath());
    const complete = (id: string, at: string) => {
      const timestamp = new Date(at);
      repository.enqueueExecutionJob({
        id,
        kind: 'network_probe',
        resourceId: `resource_${id}`,
        maxAttempts: 3,
        payload: { fixture: id }
      }, timestamp);
      repository.claimExecutionJob(
        { leaseOwner: `owner_${id}`, leaseDurationMs: 60_000 },
        timestamp
      );
      repository.completeExecutionJob(
        { id, leaseOwner: `owner_${id}` },
        timestamp
      );
    };

    complete('exec_metrics_old_terminal', '2026-05-01T00:00:00.000Z');
    complete('exec_metrics_recent_terminal', '2026-07-21T00:00:00.000Z');

    const metrics = repository.getExecutionQueueMetrics(
      new Date('2026-07-22T00:00:00.000Z'),
      30
    );

    expect(metrics.byStatus.succeeded).toBe(1);
    expect(metrics.byKind.network_probe.succeeded).toBe(1);
    expect(metrics.ready).toBe(0);
    expect(metrics.active).toBe(0);

    repository.close();
  });

  test('creates the domain resource and queue row in one transaction', () => {
    const databasePath = createTempDatabasePath();
    const repository = createRepository(databasePath);
    const job = createLatencyJob('job_atomic_create');

    const execution = repository.createExecutionResource({
      executionJob: {
        id: 'exec_atomic_create',
        kind: 'network_probe',
        resourceId: job.id,
        maxAttempts: 3,
        payload: { jobIds: [job.id] }
      },
      result: { kind: 'network_probe', jobs: [job], run: null }
    });

    expect(execution.status).toBe('queued');
    expect(repository.getJob(job.id)?.id).toBe(job.id);

    expect(() => repository.createExecutionResource({
      executionJob: {
        id: 'exec_atomic_create',
        kind: 'network_probe',
        resourceId: 'job_conflicting_resource',
        maxAttempts: 3,
        payload: { jobIds: ['job_rolled_back'] }
      },
      result: {
        kind: 'network_probe',
        jobs: [createLatencyJob('job_rolled_back')],
        run: null
      }
    })).toThrow('Execution job id already belongs to a different resource');
    expect(repository.getJob('job_rolled_back')).toBeNull();

    repository.close();
  });

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

  test('rejects a regional completion after its accepted deadline', () => {
    const databasePath = createTempDatabasePath();
    const repository = createRepository(databasePath);
    const acceptedAt = new Date('2026-07-22T00:00:00.000Z');
    const deadlineAt = '2026-07-22T00:00:01.000Z';
    const job = createLatencyJob('job_regional_deadline');
    const record: RegionalExecutionRecord = {
      id: 'regional_deadline:tokyo',
      requestDigest: 'a'.repeat(64),
      request: {
        idempotencyKey: 'regional_deadline:tokyo',
        runnerType: 'network_probe',
        targets: [{
          targetId: 'homepage',
          url: job.url
        }],
        deadlineMs: 1_000,
        maxAttempts: 1,
        timestamp: acceptedAt.toISOString(),
        signature: 'b'.repeat(64),
        keyVersion: 'current'
      },
      provenance: {
        regionId: 'tokyo',
        runnerType: 'network_probe',
        runtime: {
          version: '0.3.0-test',
          imageDigest: null
        },
        runner: {
          id: 'probe-rs',
          implementation: 'rust',
          imageDigest: null
        }
      },
      targetLinks: [{
        targetId: 'homepage',
        jobId: job.id,
        executionJobId: 'exec_regional_deadline'
      }],
      acceptedAt: acceptedAt.toISOString(),
      deadlineAt,
      cancelledAt: null,
      deadlineExceededAt: null,
      createdAt: acceptedAt.toISOString(),
      updatedAt: acceptedAt.toISOString()
    };

    repository.createRegionalExecution({
      record,
      resources: [{
        executionJob: {
          id: 'exec_regional_deadline',
          kind: 'network_probe',
          resourceId: job.id,
          maxAttempts: 1,
          payload: {
            version: 'v1',
            jobIds: [job.id],
            checkId: null,
            runId: null,
            regionalExecutionId: record.id,
            deadlineAt,
            expectedProvenance: record.provenance
          }
        },
        result: {
          kind: 'network_probe',
          jobs: [job],
          run: null
        }
      }]
    }, acceptedAt);
    repository.claimExecutionJob(
      { leaseOwner: 'regional-executor', leaseDurationMs: 10_000 },
      acceptedAt
    );
    repository.markExecutionJobRunning(
      {
        id: 'exec_regional_deadline',
        leaseOwner: 'regional-executor',
        leaseDurationMs: 10_000
      },
      new Date('2026-07-22T00:00:00.100Z')
    );

    expect(repository.completeExecutionJob(
      {
        id: 'exec_regional_deadline',
        leaseOwner: 'regional-executor'
      },
      new Date('2026-07-22T00:00:01.001Z')
    )).toBeNull();
    expect(repository.getExecutionJob('exec_regional_deadline')?.status)
      .toBe('cancelled');
    expect(repository.getRegionalExecution(record.id)).toMatchObject({
      cancelledAt: null,
      deadlineExceededAt: '2026-07-22T00:00:01.001Z'
    });

    repository.close();
  });

  test('scopes regional claims and exhausted finalization to network probes', () => {
    const databasePath = createTempDatabasePath();
    const repository = createRepository(databasePath);
    const queuedAt = new Date('2026-07-22T00:00:00.000Z');
    const networkQueuedAt = new Date('2026-07-22T00:00:00.500Z');
    const expiredAt = new Date('2026-07-22T00:00:02.000Z');

    repository.enqueueExecutionJob({
      id: 'exec_legacy_browser',
      kind: 'browser_audit',
      resourceId: 'audit_legacy_browser',
      maxAttempts: 1,
      payload: {
        version: 'v1',
        auditId: 'audit_legacy_browser'
      }
    }, queuedAt);
    expect(repository.claimExecutionJob({
      leaseOwner: 'full-executor',
      leaseDurationMs: 1_000
    }, queuedAt)?.id).toBe('exec_legacy_browser');

    const networkJob = createLatencyJob('job_regional_only');
    repository.createExecutionResource({
      executionJob: {
        id: 'exec_regional_only',
        kind: 'network_probe',
        resourceId: networkJob.id,
        maxAttempts: 2,
        payload: {
          version: 'v1',
          jobIds: [networkJob.id],
          checkId: null,
          runId: null,
          regionalExecutionId: null,
          deadlineAt: null,
          expectedProvenance: null
        }
      },
      result: {
        kind: 'network_probe',
        jobs: [networkJob],
        run: null
      }
    }, networkQueuedAt);

    expect(repository.claimExecutionJob({
      leaseOwner: 'regional-executor',
      leaseDurationMs: 10_000,
      kind: 'network_probe'
    }, expiredAt)?.id).toBe('exec_regional_only');
    expect(repository.getExecutionJob('exec_legacy_browser')?.status).toBe('leased');

    expect(repository.claimExecutionJob({
      leaseOwner: 'full-executor',
      leaseDurationMs: 10_000
    }, expiredAt)).toBeNull();
    expect(repository.getExecutionJob('exec_legacy_browser')?.status).toBe('failed');

    repository.close();
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

  test('bounds exhausted-job finalization without blocking an eligible claim', () => {
    const databasePath = createTempDatabasePath();
    let repository = createRepository(databasePath);
    const queuedAt = new Date('2026-07-22T00:00:00.000Z');
    const exhaustedCount = executionExhaustionFinalizationBatchSize + 5;

    for (let index = 0; index < exhaustedCount; index += 1) {
      const auditId = `audit_exhausted_${String(index).padStart(3, '0')}`;
      repository.enqueueExecutionJob({
        id: `exec_${auditId}`,
        kind: 'browser_audit',
        resourceId: auditId,
        maxAttempts: 1,
        payload: { version: 'v1', auditId }
      }, queuedAt);
    }
    repository.enqueueExecutionJob({
      id: 'exec_audit_eligible_after_exhausted',
      kind: 'browser_audit',
      resourceId: 'audit_eligible_after_exhausted',
      maxAttempts: 1,
      payload: {
        version: 'v1',
        auditId: 'audit_eligible_after_exhausted'
      }
    }, queuedAt);
    repository.close();

    const database = new Database(databasePath);
    database.query(`
      UPDATE execution_jobs
      SET attempt_count = max_attempts
      WHERE id LIKE 'exec_audit_exhausted_%'
    `).run();
    database.close();

    repository = createRepository(databasePath);
    expect(repository.claimExecutionJob(
      { leaseOwner: 'executor-bounded', leaseDurationMs: 10_000 },
      queuedAt
    )?.id).toBe('exec_audit_eligible_after_exhausted');
    expect(repository.listExecutionJobs().filter((job) => job.status === 'failed'))
      .toHaveLength(executionExhaustionFinalizationBatchSize);
    expect(repository.claimExecutionJob(
      { leaseOwner: 'executor-next-batch', leaseDurationMs: 10_000 },
      queuedAt
    )).toBeNull();
    expect(repository.listExecutionJobs().filter((job) => job.status === 'failed'))
      .toHaveLength(exhaustedCount);

    repository.close();
  });

  test('keeps Browser Audit resources aligned with terminal queue outcomes', () => {
    const databasePath = createTempDatabasePath();
    const repository = createRepository(databasePath);
    const queuedAt = new Date('2026-07-22T00:00:00.000Z');

    for (const [id, maxAttempts] of [
      ['audit_1_failed_queue', 1],
      ['audit_2_expired_queue', 1],
      ['audit_3_cancelled_queue', 3]
    ] as const) {
      repository.createExecutionResource({
        executionJob: {
          id: `exec_${id}`,
          kind: 'browser_audit',
          resourceId: id,
          maxAttempts,
          payload: { version: 'v1', auditId: id }
        },
        result: { kind: 'browser_audit', audit: createBrowserAudit(id) }
      }, queuedAt);
    }

    const failedLease = repository.claimExecutionJob(
      { leaseOwner: 'executor-failed', leaseDurationMs: 10_000 },
      queuedAt
    )!;
    repository.markExecutionJobRunning({
      id: failedLease.id,
      leaseOwner: 'executor-failed',
      leaseDurationMs: 10_000
    }, queuedAt);
    expect(repository.failExecutionJob({
      id: failedLease.id,
      leaseOwner: 'executor-failed',
      error: {
        code: 'execution_timeout',
        message: 'Execution exceeded the configured time limit',
        retryable: true
      }
    }, new Date('2026-07-22T00:00:01.000Z'))?.status).toBe('failed');
    expect(repository.getBrowserAudit(failedLease.resourceId)).toMatchObject({
      status: 'failed',
      completedAt: '2026-07-22T00:00:01.000Z',
      error: 'Browser Audit execution stopped before producing a result'
    });
    repository.saveBrowserAudit(browserAuditResourceSchema.parse({
      ...createBrowserAudit(failedLease.resourceId),
      status: 'running',
      startedAt: '2026-07-22T00:00:00.500Z'
    }));
    expect(repository.failExecutionJob({
      id: failedLease.id,
      leaseOwner: 'executor-failed',
      error: {
        code: 'execution_timeout',
        message: 'Execution exceeded the configured time limit',
        retryable: true
      }
    }, new Date('2026-07-22T00:00:01.500Z'))?.status).toBe('failed');
    expect(repository.getBrowserAudit(failedLease.resourceId)).toMatchObject({
      status: 'failed',
      startedAt: '2026-07-22T00:00:00.500Z',
      completedAt: '2026-07-22T00:00:01.000Z',
      error: 'Browser Audit execution stopped before producing a result'
    });

    const expiredLease = repository.claimExecutionJob(
      { leaseOwner: 'executor-expired', leaseDurationMs: 1_000 },
      queuedAt
    )!;
    expect(expiredLease.resourceId).toBe('audit_2_expired_queue');
    expect(repository.claimExecutionJob(
      { leaseOwner: 'executor-next', leaseDurationMs: 1_000 },
      new Date('2026-07-22T00:00:02.000Z')
    )?.resourceId).toBe('audit_3_cancelled_queue');
    expect(repository.getBrowserAudit('audit_2_expired_queue')).toMatchObject({
      status: 'failed',
      completedAt: '2026-07-22T00:00:02.000Z'
    });

    expect(repository.cancelExecutionJob(
      'exec_audit_3_cancelled_queue',
      new Date('2026-07-22T00:00:03.000Z')
    )?.status).toBe('cancelled');
    expect(repository.getBrowserAudit('audit_3_cancelled_queue')).toMatchObject({
      status: 'cancelled',
      startedAt: null,
      completedAt: '2026-07-22T00:00:03.000Z',
      error: null
    });

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

  test('bounds how far execution availability may be scheduled into the future', () => {
    const databasePath = createTempDatabasePath();
    const repository = createRepository(databasePath);
    const now = new Date('2026-07-22T00:00:00.000Z');
    const maximumAvailableAt = new Date(
      now.getTime() + executionAvailabilityMaxDelayMs
    ).toISOString();

    expect(repository.enqueueExecutionJob({
      id: 'exec_available_boundary',
      kind: 'network_probe',
      resourceId: 'job_available_boundary',
      maxAttempts: 2,
      availableAt: maximumAvailableAt,
      payload: { jobId: 'job_available_boundary' }
    }, now).availableAt).toBe(maximumAvailableAt);

    expect(() => repository.enqueueExecutionJob({
      id: 'exec_available_too_far',
      kind: 'network_probe',
      resourceId: 'job_available_too_far',
      maxAttempts: 2,
      availableAt: new Date(
        now.getTime() + executionAvailabilityMaxDelayMs + 1
      ).toISOString(),
      payload: { jobId: 'job_available_too_far' }
    }, now)).toThrow('more than 7 days');

    repository.close();
  });

  test('rechecks lease ownership inside result and follow-up transactions', () => {
    const databasePath = createTempDatabasePath();
    const repository = createRepository(databasePath);
    const queuedAt = new Date('2026-07-22T00:00:00.000Z');
    repository.saveCheckProfileRun(createRun());
    repository.enqueueExecutionJob({
      id: 'exec_lease_result',
      kind: 'webhook_delivery',
      resourceId: 'run_lease_result',
      maxAttempts: 3,
      payload: { runId: 'run_lease_result' }
    }, queuedAt);
    repository.claimExecutionJob(
      { leaseOwner: 'executor-a', leaseDurationMs: 1_000 },
      queuedAt
    );
    repository.markExecutionJobRunning(
      {
        id: 'exec_lease_result',
        leaseOwner: 'executor-a',
        leaseDurationMs: 1_000
      },
      queuedAt
    );

    const delivery = createDelivery('webhook_lease_result');
    expect(repository.saveExecutionResourceResult({
      executionJobId: 'exec_lease_result',
      leaseOwner: 'executor-a',
      result: { kind: 'webhook_delivery', runId: 'run_lease_result', delivery }
    }, new Date('2026-07-22T00:00:02.000Z'))).toBe(false);
    expect(repository.getCheckProfileRun('run_lease_result')?.alertDeliveries).toEqual([]);

    repository.claimExecutionJob(
      { leaseOwner: 'executor-b', leaseDurationMs: 10_000 },
      new Date('2026-07-22T00:00:02.000Z')
    );
    repository.markExecutionJobRunning(
      {
        id: 'exec_lease_result',
        leaseOwner: 'executor-b',
        leaseDurationMs: 10_000
      },
      new Date('2026-07-22T00:00:02.000Z')
    );
    expect(repository.saveExecutionResourceResult({
      executionJobId: 'exec_lease_result',
      leaseOwner: 'executor-b',
      result: { kind: 'webhook_delivery', runId: 'run_lease_result', delivery }
    }, new Date('2026-07-22T00:00:03.000Z'))).toBe(true);
    expect(repository.getCheckProfileRun('run_lease_result')?.alertDeliveries).toHaveLength(1);

    expect(repository.enqueueExecutionJobs({
      executionJobId: 'exec_lease_result',
      leaseOwner: 'executor-a',
      jobs: [{
        id: 'exec_stale_followup',
        kind: 'webhook_delivery',
        resourceId: 'run_lease_result',
        maxAttempts: 3,
        payload: { runId: 'run_lease_result' }
      }]
    }, new Date('2026-07-22T00:00:03.000Z'))).toBeNull();
    expect(repository.getExecutionJob('exec_stale_followup')).toBeNull();

    repository.close();
  });

  test('atomically appends independent webhook deliveries without lost updates', () => {
    const databasePath = createTempDatabasePath();
    const repository = createRepository(databasePath);
    const queuedAt = new Date('2026-07-22T00:00:00.000Z');
    repository.saveCheckProfileRun(createRun());

    for (const targetId of ['webhook_a', 'webhook_b']) {
      repository.enqueueExecutionJob({
        id: `exec_${targetId}`,
        kind: 'webhook_delivery',
        resourceId: 'run_lease_result',
        maxAttempts: 3,
        payload: { runId: 'run_lease_result', targetId }
      }, queuedAt);
    }

    const first = repository.claimExecutionJob(
      { leaseOwner: 'executor-a', leaseDurationMs: 10_000 },
      queuedAt
    )!;
    repository.markExecutionJobRunning({
      id: first.id,
      leaseOwner: 'executor-a',
      leaseDurationMs: 10_000
    }, queuedAt);
    const second = repository.claimExecutionJob(
      { leaseOwner: 'executor-b', leaseDurationMs: 10_000 },
      queuedAt
    )!;
    repository.markExecutionJobRunning({
      id: second.id,
      leaseOwner: 'executor-b',
      leaseDurationMs: 10_000
    }, queuedAt);

    const firstTargetId = first.id.replace('exec_', '');
    const secondTargetId = second.id.replace('exec_', '');
    expect(repository.saveExecutionResourceResult({
      executionJobId: second.id,
      leaseOwner: 'executor-b',
      result: {
        kind: 'webhook_delivery',
        runId: 'run_lease_result',
        delivery: createDelivery(secondTargetId)
      }
    }, new Date('2026-07-22T00:00:01.000Z'))).toBe(true);
    expect(repository.saveExecutionResourceResult({
      executionJobId: first.id,
      leaseOwner: 'executor-a',
      result: {
        kind: 'webhook_delivery',
        runId: 'run_lease_result',
        delivery: createDelivery(firstTargetId)
      }
    }, new Date('2026-07-22T00:00:01.000Z'))).toBe(true);
    expect(repository.saveExecutionResourceResult({
      executionJobId: first.id,
      leaseOwner: 'executor-a',
      result: {
        kind: 'webhook_delivery',
        runId: 'run_lease_result',
        delivery: createDelivery(firstTargetId)
      }
    }, new Date('2026-07-22T00:00:01.000Z'))).toBe(true);

    expect(
      repository.getCheckProfileRun('run_lease_result')?.alertDeliveries
        .map((delivery) => delivery.targetId)
        .sort()
    ).toEqual(['webhook_a', 'webhook_b']);

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
      .run('{"jobId":"raw-sensitive-value"}', 'exec_corrupt');
    database.close();

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...values: unknown[]) => warnings.push(values.map(String).join(' '));

    try {
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
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings).toHaveLength(3);
    expect(JSON.parse(warnings[0]!).diagnostic).toEqual({ type: 'unencrypted_payload' });
    expect(warnings.join('\n')).not.toContain('raw-sensitive-value');

    repository.close();
  });
});
