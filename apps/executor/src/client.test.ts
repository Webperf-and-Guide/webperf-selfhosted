import { describe, expect, test } from 'bun:test';
import type { ExecutionJob } from '@webperf/contracts';
import { createExecutorApiClient, ExecutorApiError } from './client';

const leasedJob: ExecutionJob = {
  id: 'exec_client',
  kind: 'network_probe',
  resourceId: 'job_client',
  status: 'leased',
  leaseOwner: 'executor-client',
  leaseExpiresAt: '2026-07-22T00:01:00.000Z',
  attemptCount: 1,
  maxAttempts: 3,
  availableAt: '2026-07-22T00:00:00.000Z',
  payload: { jobId: 'job_client' },
  error: null,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  completedAt: null
};

describe('executor API client', () => {
  test('uses configuration errors consistently for invalid base URLs', () => {
    const createWithBaseUrl = (baseUrl: string) => () => createExecutorApiClient({
      baseUrl,
      internalSecret: 'executor-client-internal-secret'
    });

    expect(createWithBaseUrl('not-a-url')).toThrow('Executor API base URL is invalid');
    expect(createWithBaseUrl('ftp://api.test')).toThrow(
      'Executor API base URL must be a credential-free HTTP(S) origin'
    );

    try {
      createWithBaseUrl('not-a-url')();
    } catch (error) {
      expect(error).not.toBeInstanceOf(ExecutorApiError);
    }
  });

  test('sends the internal bearer credential and validates claim responses', async () => {
    let request: Request | undefined;
    const client = createExecutorApiClient({
      baseUrl: 'http://api.test:8788',
      internalSecret: 'executor-client-internal-secret',
      fetchImpl: (async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1]
      ) => {
        request = new Request(input, init);
        return Response.json(leasedJob, {
          headers: { 'cache-control': 'no-store' }
        });
      }) as unknown as typeof fetch
    });

    expect(
      await client.claim({ leaseOwner: 'executor-client', leaseDurationMs: 60_000 })
    ).toEqual(leasedJob);
    expect(new URL(request!.url).pathname).toBe('/internal/execution-jobs/claim');
    expect(request!.headers.get('authorization')).toBe(
      'Bearer executor-client-internal-secret'
    );
  });

  test('does not reflect an API error body into the thrown error', async () => {
    const client = createExecutorApiClient({
      baseUrl: 'http://api.test:8788',
      internalSecret: 'executor-client-internal-secret',
      fetchImpl: (async () =>
        new Response('Bearer raw-sensitive-api-error', { status: 500 })) as unknown as typeof fetch
    });

    let error: unknown;

    try {
      await client.claim({ leaseOwner: 'executor-client', leaseDurationMs: 60_000 });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ExecutorApiError);
    expect((error as Error).message).not.toContain('raw-sensitive-api-error');
  });

  test('preserves a network failure as an internal cause', async () => {
    const networkError = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED'
    });
    const client = createExecutorApiClient({
      baseUrl: 'http://api.test:8788',
      internalSecret: 'executor-client-internal-secret',
      fetchImpl: (async () => {
        throw networkError;
      }) as unknown as typeof fetch
    });

    let error: unknown;

    try {
      await client.claim({ leaseOwner: 'executor-client', leaseDurationMs: 60_000 });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ExecutorApiError);
    expect((error as ExecutorApiError).cause).toBe(networkError);
  });

  test('persists results and enqueues follow-ups through lease-bound routes', async () => {
    const requests: Request[] = [];
    const client = createExecutorApiClient({
      baseUrl: 'http://api.test:8788',
      internalSecret: 'executor-client-internal-secret',
      fetchImpl: (async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1]
      ) => {
        const request = new Request(input, init);
        requests.push(request);
        return request.url.endsWith('/result')
          ? new Response(null, { status: 204 })
          : Response.json({ jobs: [leasedJob] }, { status: 201 });
      }) as unknown as typeof fetch
    });

    await client.saveResult('exec_client', {
      leaseOwner: 'executor-client',
      result: {
        kind: 'webhook_delivery',
        run: {
          id: 'run_client',
          profileId: 'check_client',
          trigger: 'manual',
          createdAt: '2026-07-22T00:00:00.000Z',
          routeCount: 1,
          routes: [{
            routeId: 'route_client',
            routeLabel: 'Home',
            url: 'https://example.com/',
            jobId: 'job_client',
            browserAudit: null
          }],
          browserAuditSummary: null,
          evaluation: null,
          alertDeliveries: []
        }
      }
    });
    const followups = await client.enqueueFollowups('exec_client', {
      leaseOwner: 'executor-client',
      jobs: [{
        id: 'exec_followup',
        kind: 'webhook_delivery',
        resourceId: 'run_client',
        maxAttempts: 3,
        payload: {
          version: 'v1',
          runId: 'run_client',
          target: {
            id: 'webhook_client',
            name: 'Client hook',
            url: 'https://hooks.example.com/',
            enabled: true,
            secret: null
          },
          body: { type: 'check.alert' }
        }
      }]
    });

    expect(followups.jobs).toEqual([leasedJob]);
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/internal/execution-jobs/exec_client/result',
      '/internal/execution-jobs/exec_client/followups'
    ]);
  });
});
