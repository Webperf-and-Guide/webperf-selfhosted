import { describe, expect, test } from 'bun:test';
import type {
  BrowserAuditWorkerRequest,
  ExecutionJob,
  ExecutionResourceContext,
  ExecutionResourceResultRequest
} from '@webperf/contracts';
import { browserAuditResourceSchema } from '@webperf/contracts';
import { createBrowserAuditSignature } from '@webperf/domain-core';
import {
  createBrowserAuditExecutionHandler,
  resolveBrowserAuditEndpoint
} from './browser-audit-handler';
import type { ExecutorApiClient } from './client';
import { ExecutionFailure } from './runner';

const executionJob: ExecutionJob = {
  id: 'exec_audit_handler',
  kind: 'browser_audit',
  resourceId: 'audit_handler',
  status: 'running',
  leaseOwner: 'executor-browser',
  leaseExpiresAt: '2099-07-22T00:01:00.000Z',
  attemptCount: 1,
  maxAttempts: 3,
  availableAt: '2026-07-22T00:00:00.000Z',
  payload: { version: 'v1', auditId: 'audit_handler' },
  error: null,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  completedAt: null
};

const queuedAudit = () => browserAuditResourceSchema.parse({
  id: 'audit_handler',
  targetUrl: 'https://example.com/path?release=secret-header-value',
  region: 'tokyo',
  status: 'queued',
  requestedAt: '2026-07-22T00:00:00.000Z',
  startedAt: null,
  completedAt: null,
  policy: {
    preset: 'mobile',
    flow: { steps: [{ type: 'navigate', url: 'https://example.com/' }] }
  },
  customHeaders: [{ name: 'Authorization', value: 'secret-header-value' }],
  cookies: [{ name: 'session', value: 'secret-cookie-value', domain: 'example.com' }],
  result: null,
  error: null
});

const context = (): ExecutionResourceContext => ({
  kind: 'browser_audit',
  executionJob,
  payload: { version: 'v1', auditId: 'audit_handler' },
  audit: queuedAudit()
});

const createClient = (savedResults: ExecutionResourceResultRequest[]): ExecutorApiClient => ({
  claim: async () => null,
  start: async () => executionJob,
  renew: async () => executionJob,
  complete: async () => executionJob,
  fail: async () => executionJob,
  context: async () => context(),
  saveResult: async (_id, result) => {
    savedResults.push(structuredClone(result));
  },
  enqueueFollowups: async () => ({ jobs: [] })
});

const successfulResult = {
  coreMetrics: {
    lcpMs: 1_480,
    cls: 0.02
  },
  scores: {
    performance: 0.92
  },
  extendedMetrics: [],
  checkpoints: [],
  issues: [],
  artifacts: [],
  toolchain: {
    engine: { id: 'lighthouse', version: '12.6.0' },
    browser: { name: 'Chrome', version: '136.0.0.0' },
    runtime: { name: 'Bun', version: '1.3.13' },
    components: [{ name: 'puppeteer-core', version: '24.7.1' }]
  },
  startedAt: '2026-07-22T00:00:01.000Z',
  completedAt: '2026-07-22T00:00:03.000Z'
};

describe('Browser Audit execution handler', () => {
  test('persists running and succeeded states around a signed runner request', async () => {
    const savedResults: ExecutionResourceResultRequest[] = [];
    const runnerRequests: BrowserAuditWorkerRequest[] = [];
    const handler = createBrowserAuditExecutionHandler({
      client: createClient(savedResults),
      leaseOwner: 'executor-browser',
      browserAuditSharedSecret: 'browser-handler-shared-secret',
      browserAuditBaseUrl: 'http://127.0.0.1:8081',
      fetchImpl: (async (
        _input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1]
      ) => {
        runnerRequests.push(JSON.parse(String(init?.body)) as BrowserAuditWorkerRequest);
        return Response.json({
          executionId: 'audit_handler',
          status: 'succeeded',
          result: successfulResult,
          error: null
        });
      }) as unknown as typeof fetch
    });

    await handler(executionJob, new AbortController().signal);

    const runnerRequest = runnerRequests[0];
    if (!runnerRequest) {
      throw new Error('Expected a Browser Audit runner request');
    }
    expect(runnerRequest.customHeaders[0]?.value).toBe('secret-header-value');
    expect(runnerRequest.cookies[0]?.value).toBe('secret-cookie-value');
    expect(runnerRequest.signature).toBe(
      await createBrowserAuditSignature(
        'browser-handler-shared-secret',
        runnerRequest
      )
    );
    expect(savedAudit(savedResults, 0).status).toBe('running');
    expect(savedAudit(savedResults, -1)).toMatchObject({
      status: 'succeeded',
      completedAt: successfulResult.completedAt,
      error: null
    });
  });

  test('persists queued state before retrying a busy runner', async () => {
    const savedResults: ExecutionResourceResultRequest[] = [];
    const handler = createBrowserAuditExecutionHandler({
      client: createClient(savedResults),
      leaseOwner: 'executor-browser',
      browserAuditSharedSecret: 'browser-handler-shared-secret',
      browserAuditBaseUrl: 'https://runner.example.com',
      fetchImpl: (async () => Response.json(
        { error: 'busy Bearer secret-header-value' },
        { status: 409 }
      )) as unknown as typeof fetch
    });

    let error: unknown;
    try {
      await handler(executionJob, new AbortController().signal);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ExecutionFailure);
    expect(error).toMatchObject({
      code: 'browser_audit_runner_unavailable',
      retryable: true
    });
    expect(savedAudit(savedResults, -1)).toMatchObject({
      status: 'queued',
      error: 'Browser Audit execution will be retried'
    });
    expect(JSON.stringify(savedResults)).not.toContain('busy Bearer');
  });

  test('redacts runner failure details before terminal persistence', async () => {
    const savedResults: ExecutionResourceResultRequest[] = [];
    const handler = createBrowserAuditExecutionHandler({
      client: createClient(savedResults),
      leaseOwner: 'executor-browser',
      browserAuditSharedSecret: 'browser-handler-shared-secret',
      browserAuditBaseUrl: 'https://runner.example.com',
      fetchImpl: (async () => Response.json({
        executionId: 'audit_handler',
        status: 'failed',
        result: null,
        error: 'secret-header-value at https://example.com/path?token=secret-cookie-value'
      }, { status: 500 })) as unknown as typeof fetch
    });

    await handler(executionJob, new AbortController().signal);

    const failed = savedAudit(savedResults, -1);
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('[REDACTED] at https://example.com/path?redacted');
    expect(failed.error).not.toContain('secret-cookie-value');
  });

  test('fails explicitly when the runner responds for a different execution', async () => {
    const savedResults: ExecutionResourceResultRequest[] = [];
    const handler = createBrowserAuditExecutionHandler({
      client: createClient(savedResults),
      leaseOwner: 'executor-browser',
      browserAuditSharedSecret: 'browser-handler-shared-secret',
      browserAuditBaseUrl: 'https://runner.example.com',
      fetchImpl: (async () => Response.json({
        executionId: 'audit_different',
        status: 'succeeded',
        result: successfulResult,
        error: null
      })) as unknown as typeof fetch
    });

    await handler(executionJob, new AbortController().signal);

    expect(savedAudit(savedResults, -1)).toMatchObject({
      status: 'failed',
      error: 'Browser Audit runner returned a response for a different execution'
    });
  });

  test('requires HTTPS for non-loopback runners unless explicitly trusted', () => {
    expect(resolveBrowserAuditEndpoint('https://runner.example.com').href).toBe(
      'https://runner.example.com/audit'
    );
    expect(resolveBrowserAuditEndpoint('http://127.0.0.1:8081').href).toBe(
      'http://127.0.0.1:8081/audit'
    );
    expect(() => resolveBrowserAuditEndpoint('http://browser-audit:8080')).toThrow(
      'allowed credential-free origin'
    );
    expect(resolveBrowserAuditEndpoint('http://browser-audit:8080', true).href).toBe(
      'http://browser-audit:8080/audit'
    );
  });
});

const savedAudit = (
  results: ExecutionResourceResultRequest[],
  index: number
) => {
  const result = index < 0 ? results.at(index)?.result : results[index]?.result;

  if (result?.kind !== 'browser_audit') {
    throw new Error('Expected a Browser Audit result');
  }

  return result.audit;
};
