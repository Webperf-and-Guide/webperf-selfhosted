import { describe, expect, test } from 'bun:test';
import type { JsonValue } from '../src/execution';
import {
  defaultExecutionRetryDelayMs,
  enqueueExecutionJobSchema,
  executionJobFailRequestSchema,
  executionJobSchema,
  executionPayloadMaxBytes,
  executionPayloadMaxDepth
} from '../src/execution';
import {
  networkProbeExecutionContextSchema,
  networkProbeExecutionPayloadSchema
} from '../src/execution-resources';
import {
  createWebhookAlertTargetSchema,
  executionProviderSchema,
  webhookAlertTargetSchema
} from '../src/public-api';

const nestedPayload = (depth: number): JsonValue => {
  let value: JsonValue = 'leaf';

  for (let index = 0; index < depth; index += 1) {
    value = { child: value };
  }

  return value;
};

const baseExecutionJob = {
  id: 'exec_contract',
  kind: 'network_probe' as const,
  resourceId: 'job_contract',
  status: 'queued' as const,
  leaseOwner: null,
  leaseExpiresAt: null,
  attemptCount: 0,
  maxAttempts: 3,
  availableAt: '2026-07-22T00:00:00.000Z',
  payload: { jobId: 'job_contract' },
  error: null,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  completedAt: null
};

const baseLatencyJob = {
  id: 'job_contract',
  url: 'https://example.com/',
  status: 'queued' as const,
  note: null,
  requestedAt: '2026-07-22T00:00:00.000Z',
  startedAt: null,
  completedAt: null,
  requesterIp: null,
  selectedRegions: ['tokyo'],
  targets: [],
  summary: { total: 0, succeeded: 0, failed: 0, inflight: 0 }
};

const comparedRun = {
  id: 'run_compared',
  profileId: 'check_contract',
  trigger: 'manual' as const,
  createdAt: '2026-07-22T00:00:00.000Z',
  routeCount: 1,
  routes: [{
    routeId: 'route_contract',
    routeLabel: 'Home',
    url: 'https://example.com/',
    jobId: baseLatencyJob.id,
    browserAudit: null
  }],
  browserAuditSummary: null,
  evaluation: null,
  alertDeliveries: []
};

const baseNetworkContext = {
  kind: 'network_probe' as const,
  executionJob: baseExecutionJob,
  payload: {
    version: 'v1' as const,
    jobIds: [baseLatencyJob.id],
    checkId: null,
    runId: null
  },
  jobs: [baseLatencyJob],
  check: null,
  run: null
};

describe('execution job contracts', () => {
  test('accepts extension providers only as safe identifiers', () => {
    expect(executionProviderSchema.safeParse('selfhost').success).toBe(true);
    expect(executionProviderSchema.safeParse('private_runner-2').success).toBe(true);
    expect(executionProviderSchema.safeParse('../provider').success).toBe(false);
    expect(executionProviderSchema.safeParse('provider name').success).toBe(false);
  });

  test('bounds recursive payload depth', () => {
    expect(
      enqueueExecutionJobSchema.safeParse({
        id: 'exec_depth_ok',
        kind: 'network_probe',
        resourceId: 'job_depth_ok',
        payload: nestedPayload(executionPayloadMaxDepth)
      }).success
    ).toBe(true);
    expect(
      enqueueExecutionJobSchema.safeParse({
        id: 'exec_depth_rejected',
        kind: 'network_probe',
        resourceId: 'job_depth_rejected',
        payload: nestedPayload(executionPayloadMaxDepth + 1)
      }).success
    ).toBe(false);
  });

  test('bounds serialized payload bytes', () => {
    expect(
      enqueueExecutionJobSchema.safeParse({
        id: 'exec_size_ok',
        kind: 'network_probe',
        resourceId: 'job_size_ok',
        payload: 'x'.repeat(executionPayloadMaxBytes - 2)
      }).success
    ).toBe(true);
    expect(
      enqueueExecutionJobSchema.safeParse({
        id: 'exec_size_rejected',
        kind: 'network_probe',
        resourceId: 'job_size_rejected',
        payload: 'x'.repeat(executionPayloadMaxBytes - 1)
      }).success
    ).toBe(false);
  });

  test('rejects prototype-related keys at every payload depth', () => {
    for (const payload of [
      JSON.parse('{"__proto__":{"polluted":true}}'),
      JSON.parse('{"nested":{"constructor":{"polluted":true}}}'),
      JSON.parse('{"items":[{"prototype":"blocked"}]}')
    ]) {
      expect(enqueueExecutionJobSchema.safeParse({
        id: 'exec_reserved_key',
        kind: 'network_probe',
        resourceId: 'job_reserved_key',
        payload
      }).success).toBe(false);
    }
  });

  test('documents but does not inject the repository retry-delay default', () => {
    const parsed = executionJobFailRequestSchema.parse({
      leaseOwner: 'executor-contract',
      error: { code: 'temporary', message: 'Temporary failure', retryable: true }
    });

    expect(parsed.retryDelayMs).toBeUndefined();
    expect(defaultExecutionRetryDelayMs).toBe(1_000);
    expect(executionJobFailRequestSchema.shape.retryDelayMs.description)
      .toContain('defaults to 1000ms');
  });

  test('requires configured webhook signing secrets to meet the minimum length', () => {
    const persistedTarget = {
      id: 'webhook_contract',
      name: 'Release hook',
      url: 'https://hooks.example.com/webperf',
      enabled: true
    };
    const createTarget = {
      name: persistedTarget.name,
      url: persistedTarget.url
    };

    expect(webhookAlertTargetSchema.safeParse({
      ...persistedTarget,
      secret: null
    }).success).toBe(true);
    expect(webhookAlertTargetSchema.safeParse({
      ...persistedTarget,
      secret: 'legacy'
    }).success).toBe(true);
    expect(webhookAlertTargetSchema.parse({
      ...persistedTarget,
      secret: ''
    }).secret).toBeNull();
    expect(createWebhookAlertTargetSchema.safeParse(createTarget).success).toBe(true);
    expect(createWebhookAlertTargetSchema.safeParse({
      ...createTarget,
      secret: 'x'.repeat(16)
    }).success).toBe(true);
    expect(createWebhookAlertTargetSchema.safeParse({
      ...createTarget,
      secret: '[REDACTED]'
    }).success).toBe(true);
    expect(createWebhookAlertTargetSchema.safeParse({
      ...createTarget,
      secret: 'short'
    }).success).toBe(false);
    expect(createWebhookAlertTargetSchema.safeParse({
      ...createTarget,
      secret: ''
    }).success).toBe(false);
  });

  test('enforces retry and lease state invariants', () => {
    expect(
      executionJobSchema.safeParse({
        ...baseExecutionJob,
        attemptCount: 4
      }).success
    ).toBe(false);
    expect(
      executionJobSchema.safeParse({
        ...baseExecutionJob,
        status: 'running',
        attemptCount: 1
      }).success
    ).toBe(false);
    expect(
      executionJobSchema.safeParse({
        ...baseExecutionJob,
        status: 'succeeded',
        completedAt: '2026-07-22T00:01:00.000Z'
      }).success
    ).toBe(true);
  });

  test('binds check and run context together for network executions', () => {
    expect(
      networkProbeExecutionPayloadSchema.safeParse({
        version: 'v1',
        jobIds: ['job_contract'],
        checkId: null,
        runId: null
      }).success
    ).toBe(true);
    expect(
      networkProbeExecutionPayloadSchema.safeParse({
        version: 'v1',
        jobIds: ['job_contract'],
        checkId: 'check_contract',
        runId: null
      }).success
    ).toBe(false);
  });

  test('binds comparison mode, run, and jobs together', () => {
    expect(networkProbeExecutionContextSchema.safeParse({
      ...baseNetworkContext,
      comparisonMode: 'baseline',
      comparedRun,
      comparedJobs: [baseLatencyJob]
    }).success).toBe(true);
    expect(networkProbeExecutionContextSchema.safeParse({
      ...baseNetworkContext,
      comparisonMode: 'baseline',
      comparedRun: null,
      comparedJobs: []
    }).success).toBe(false);
    expect(networkProbeExecutionContextSchema.safeParse({
      ...baseNetworkContext,
      comparisonMode: null,
      comparedRun,
      comparedJobs: [baseLatencyJob]
    }).success).toBe(false);
  });
});
