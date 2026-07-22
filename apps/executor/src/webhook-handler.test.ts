import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import type {
  ExecutionJob,
  ExecutionResourceContext,
  ExecutionResourceResultRequest
} from '@webperf/contracts';
import { UrlValidationError } from '@webperf/domain-core';
import type { ExecutorApiClient } from './client';
import { createWebhookExecutionHandler } from './webhook-handler';
import { ExecutionFailure } from './runner';

const executionJob: ExecutionJob = {
  id: 'exec_run_webhook_target',
  kind: 'webhook_delivery',
  resourceId: 'run_webhook',
  status: 'running',
  leaseOwner: 'executor-webhook',
  leaseExpiresAt: '2099-07-22T00:01:00.000Z',
  attemptCount: 1,
  maxAttempts: 3,
  availableAt: '2026-07-22T00:00:00.000Z',
  payload: {
    version: 'v1',
    runId: 'run_webhook',
    target: {
      id: 'target_webhook',
      name: 'Release hook',
      url: 'https://hooks.example.com/webperf',
      enabled: true,
      secret: 'webhook-signing-secret'
    },
    body: { type: 'check.alert' }
  },
  error: null,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  completedAt: null
};

const context = (): ExecutionResourceContext => ({
  kind: 'webhook_delivery',
  executionJob,
  payload: {
    version: 'v1',
    runId: 'run_webhook',
    target: {
      id: 'target_webhook',
      name: 'Release hook',
      url: 'https://hooks.example.com/webperf',
      enabled: true,
      secret: 'webhook-signing-secret'
    },
    body: { type: 'check.alert' }
  },
  run: {
    id: 'run_webhook',
    profileId: 'check_webhook',
    trigger: 'manual',
    createdAt: '2026-07-22T00:00:00.000Z',
    routeCount: 1,
    routes: [{
      routeId: 'route_webhook',
      routeLabel: 'Home',
      url: 'https://example.com/',
      jobId: 'job_webhook',
      browserAudit: null
    }],
    browserAuditSummary: null,
    evaluation: null,
    alertDeliveries: []
  }
});

describe('webhook execution handler', () => {
  test('uses an idempotency key and HMAC without transmitting the secret', async () => {
    const savedResults: ExecutionResourceResultRequest[] = [];
    let deliveredRequest: Request | null = null;
    const client: ExecutorApiClient = {
      claim: async () => null,
      start: async () => executionJob,
      renew: async () => executionJob,
      complete: async () => executionJob,
      fail: async () => executionJob,
      context: async () => context(),
      saveResult: async (_id, result) => {
        savedResults.push(result);
      },
      enqueueFollowups: async () => ({ jobs: [] })
    };
    const handler = createWebhookExecutionHandler({
      client,
      leaseOwner: 'executor-webhook',
      validateUrl: () => {},
      fetchImpl: (async (input, init) => {
        deliveredRequest = new Request(input, init);
        return new Response(null, { status: 204 });
      }) as typeof fetch
    });

    await handler(executionJob, new AbortController().signal);

    expect(deliveredRequest!.headers.get('idempotency-key')).toBe(executionJob.id);
    const body = await deliveredRequest!.text();
    const expectedSignature = `sha256=${createHmac('sha256', 'webhook-signing-secret')
      .update(body, 'utf8')
      .digest('hex')}`;
    expect(deliveredRequest!.headers.get('x-webperf-signature')).toBe(expectedSignature);
    expect(deliveredRequest!.headers.get('x-webperf-signature')).not.toContain(
      'webhook-signing-secret'
    );
    const result = savedResults[0]?.result;
    if (result?.kind !== 'webhook_delivery') {
      throw new Error('Expected a webhook result');
    }
    expect(result.runId).toBe('run_webhook');
    expect(result.delivery).toMatchObject({
      targetId: 'target_webhook',
      status: 'sent',
      responseStatus: 204
    });
  });

  test('rejects blocked webhook targets without retrying or issuing a request', async () => {
    let fetchCalled = false;
    const client: ExecutorApiClient = {
      claim: async () => null,
      start: async () => executionJob,
      renew: async () => executionJob,
      complete: async () => executionJob,
      fail: async () => executionJob,
      context: async () => context(),
      saveResult: async () => {},
      enqueueFollowups: async () => ({ jobs: [] })
    };
    const handler = createWebhookExecutionHandler({
      client,
      leaseOwner: 'executor-webhook',
      validateUrl: () => {
        throw new UrlValidationError(
          'blocked target with sensitive detail',
          'private_hostname'
        );
      },
      fetchImpl: (async () => {
        fetchCalled = true;
        return new Response(null, { status: 204 });
      }) as unknown as typeof fetch
    });

    let error: unknown;
    try {
      await handler(executionJob, new AbortController().signal);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ExecutionFailure);
    expect(error).toMatchObject({
      code: 'webhook_target_private_hostname',
      retryable: false
    });
    expect(String(error)).not.toContain('sensitive detail');
    expect(fetchCalled).toBe(false);
  });
});
