import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import type {
  ExecutionJob,
  ExecutionResourceContext,
  ExecutionResourceResultRequest
} from '@webperf/contracts';
import { UrlValidationError } from '@webperf/domain-core';
import type { ExecutorApiClient } from './client';
import { OutboundHttpPolicyError } from './outbound-http';
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
      now: () => new Date('2026-07-22T00:00:00.000Z'),
      requestImpl: async (input, init) => {
        deliveredRequest = new Request(input, {
          method: init.method,
          headers: init.headers,
          body: init.body,
          signal: init.signal
        });
        expect(init.addressPolicy).toBe('public');
        expect(init.discardResponseBody).toBe(true);
        return new Response(null, { status: 204 });
      }
    });

    await handler(executionJob, new AbortController().signal);

    expect(deliveredRequest!.headers.get('idempotency-key')).toBe(executionJob.id);
    const body = await deliveredRequest!.text();
    const timestamp = Math.floor(new Date('2026-07-22T00:00:00.000Z').getTime() / 1_000);
    const expectedSignature = `t=${timestamp},v1=${createHmac('sha256', 'webhook-signing-secret')
      .update(`${timestamp}.${body}`, 'utf8')
      .digest('hex')}`;
    expect(deliveredRequest!.headers.get('x-webperf-timestamp')).toBe(String(timestamp));
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
      responseStatus: 204,
      deliveredAt: '2026-07-22T00:00:00.000Z'
    });
  });

  test('records redirects without following an unvalidated destination', async () => {
    const savedResults: ExecutionResourceResultRequest[] = [];
    let requestCount = 0;
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
      requestImpl: async (_input, init) => {
        requestCount += 1;
        expect(init.addressPolicy).toBe('public');
        return new Response('redirect', {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data' }
        });
      }
    });

    await handler(executionJob, new AbortController().signal);

    expect(requestCount).toBe(1);
    expect(savedResults[0]?.result).toMatchObject({
      kind: 'webhook_delivery',
      delivery: {
        status: 'failed',
        responseStatus: 302
      }
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
      requestImpl: async () => {
        fetchCalled = true;
        return new Response(null, { status: 204 });
      }
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

  test('does not retry a hostname that resolves into a private network', async () => {
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
      requestImpl: async () => {
        throw new OutboundHttpPolicyError(
          'address_blocked',
          'resolved to 169.254.169.254'
        );
      }
    });

    await expect(handler(
      executionJob,
      new AbortController().signal
    )).rejects.toMatchObject({
      code: 'webhook_target_private_ip',
      message: 'Webhook target resolved to a blocked address',
      retryable: false
    });
  });
});
