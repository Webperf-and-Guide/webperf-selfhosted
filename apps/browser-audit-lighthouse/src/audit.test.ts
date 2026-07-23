import { describe, expect, test } from 'bun:test';
import type { BrowserAuditWorkerRequest } from '@webperf/contracts';
import { createHash } from 'node:crypto';
import type { BrowserAuditWorkerConfig } from './config';
import {
  buildChromeLaunchArgs,
  createWaitForUrlMatcher,
  isPuppeteerKeyInput,
  lighthouseArtifactContentTypes,
  launchBrowser,
  runWithinAuditDeadline,
  serializeFlowResult,
  waitForDetachedSelector,
  uploadArtifact
} from './audit';

describe('Lighthouse Chrome launch policy', () => {
  test('forces browser traffic through the pinned proxy', () => {
    const args = buildChromeLaunchArgs(
      { allowNoSandbox: false },
      'http://127.0.0.1:41234'
    );

    expect(args).toContain('--proxy-server=http://127.0.0.1:41234');
    expect(args).toContain('--proxy-bypass-list=<-loopback>');
    expect(args).toContain('--disable-quic');
    expect(args).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
    expect(args).toContain('--disable-setuid-sandbox');
    expect(args).not.toContain('--no-sandbox');
  });

  test('adds no-sandbox only for the explicit degraded mode', () => {
    expect(buildChromeLaunchArgs({ allowNoSandbox: true })).toContain('--no-sandbox');
    expect(buildChromeLaunchArgs({ allowNoSandbox: false })).not.toContain('--no-sandbox');
  });

  test('rejects a missing Chrome executable at the launch boundary', async () => {
    await expect(launchBrowser({
      chromeExecutablePath: null,
      allowNoSandbox: false
    } as BrowserAuditWorkerConfig)).rejects.toThrow('Chrome executable is not configured');
  });

  test('keeps Lighthouse MIME types aligned with the public registry', () => {
    expect(lighthouseArtifactContentTypes).toEqual({
      html: 'text/html; charset=utf-8',
      json: 'application/json',
      screenshot: 'image/png',
      trace: 'application/json'
    });
  });

  test('matches waitForUrl regexes with the linear-time engine and rejects unsupported syntax', () => {
    const matcher = createWaitForUrlMatcher(
      '^https://example\\.com/(?:reports|checks)/[0-9]+$',
      'regex'
    );
    expect(matcher('https://example.com/reports/42')).toBe(true);
    expect(matcher('https://example.com/settings/42')).toBe(false);

    expect(() => createWaitForUrlMatcher('(a+)+$', 'regex')).not.toThrow();
    expect(() => createWaitForUrlMatcher('^(secret)\\1$', 'regex'))
      .toThrow('invalid or unsupported');
    expect(() => createWaitForUrlMatcher('[', 'regex'))
      .toThrow('invalid or unsupported');
  });

  test('waits for actual selector detachment instead of hidden state', async () => {
    let queryCount = 0;
    let disposeCount = 0;
    const page = {
      $: async () => {
        queryCount += 1;
        return queryCount === 1
          ? { dispose: async () => { disposeCount += 1; } }
          : null;
      }
    } as unknown as Parameters<typeof waitForDetachedSelector>[0];

    await waitForDetachedSelector(page, '#toast', 100);
    expect(queryCount).toBe(2);
    expect(disposeCount).toBe(1);
  });

  test('validates press keys against the pinned Puppeteer keyboard layout', () => {
    expect(isPuppeteerKeyInput('Enter')).toBe(true);
    expect(isPuppeteerKeyInput('a')).toBe(true);
    expect(isPuppeteerKeyInput('not-a-puppeteer-key')).toBe(false);
  });

  test('bounds dependency work by the shared audit deadline', async () => {
    let expiredFactoryCalls = 0;
    await expect(runWithinAuditDeadline(
      async () => {
        expiredFactoryCalls += 1;
        return 'too late';
      },
      999,
      5_000,
      () => 1_000
    )).rejects.toThrow('Audit exceeded total timeout of 5000ms');
    expect(expiredFactoryCalls).toBe(0);

    await expect(runWithinAuditDeadline(
      () => new Promise<never>(() => undefined),
      Date.now() + 20,
      5_000
    )).rejects.toThrow('Audit exceeded total timeout of 5000ms');
  });

  test('normalizes circular Lighthouse flow serialization failures', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    try {
      serializeFlowResult(circular);
      throw new Error('Expected circular serialization to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('Lighthouse flow result could not be serialized');
      expect((error as Error).cause).toBeInstanceOf(TypeError);
    }
    expect(serializeFlowResult({ name: 'flow', steps: [] })).toContain('"steps": []');
  });

  test('verifies the uploaded artifact digest against the submitted bytes', async () => {
    const payload = new TextEncoder().encode('{"score":1}');
    const input = {
      executionId: 'audit_digest',
      policy: {
        timeouts: { totalTimeoutMs: 5_000 }
      },
      artifactUpload: {
        baseUrl: 'https://api.example.test',
        bearerToken: 'signed-upload-token',
        expiresAt: '2099-01-01T00:00:00.000Z',
        maxArtifactBytes: 1_024,
        allowedContentTypes: ['application/json']
      }
    } as BrowserAuditWorkerRequest;
    const responseFor = (sha256: string) => async () => new Response(JSON.stringify({
      id: 'artifact_digest',
      registryVersion: 'v1',
      kind: 'lighthouse-json',
      url: '/v1/browser-audits/audit_digest/artifacts/artifact_digest',
      filename: 'report.json',
      contentType: 'application/json',
      byteSize: payload.byteLength,
      sha256,
      createdAt: '2026-07-22T00:00:00.000Z'
    }), { headers: { 'content-type': 'application/json' } });

    let submittedBody: BodyInit | null | undefined;
    await expect(uploadArtifact(
      input,
      'lighthouse-json',
      'report.json',
      'application/json',
      payload,
      { fetchImpl: responseFor('0'.repeat(64)) }
    )).rejects.toThrow('did not match');
    await expect(uploadArtifact(
      input,
      'lighthouse-json',
      'report.json',
      'application/json',
      payload,
      {
        fetchImpl: async (_request, init) => {
          submittedBody = init?.body;
          return responseFor(createHash('sha256').update(payload).digest('hex'))();
        }
      }
    )).resolves.toHaveLength(1);
    expect(submittedBody).toBe(payload);
  });

  test('refuses artifact uploads after the shared audit deadline', async () => {
    const payload = new TextEncoder().encode('{}');
    const input = {
      executionId: 'audit_deadline',
      policy: {
        timeouts: { totalTimeoutMs: 5_000 }
      },
      artifactUpload: {
        baseUrl: 'https://api.example.test',
        bearerToken: 'signed-upload-token',
        expiresAt: '2099-01-01T00:00:00.000Z',
        maxArtifactBytes: 1_024,
        allowedContentTypes: ['application/json']
      }
    } as BrowserAuditWorkerRequest;
    let fetchCalls = 0;

    await expect(uploadArtifact(
      input,
      'lighthouse-json',
      'report.json',
      'application/json',
      payload,
      {
        deadline: 999,
        now: () => 1_000,
        async fetchImpl() {
          fetchCalls += 1;
          throw new Error('fetch must not run after the deadline');
        }
      }
    )).rejects.toThrow('Audit exceeded total timeout');
    expect(fetchCalls).toBe(0);
  });

  test('encodes upload path values and cancels rejected response bodies', async () => {
    const input = {
      executionId: 'audit/path?token=secret',
      policy: {
        timeouts: { totalTimeoutMs: 5_000 }
      },
      artifactUpload: {
        baseUrl: 'https://api.example.test',
        bearerToken: 'signed-upload-token',
        expiresAt: '2099-01-01T00:00:00.000Z',
        maxArtifactBytes: 1_024,
        allowedContentTypes: ['application/json']
      }
    } as BrowserAuditWorkerRequest;
    let requestedUrl = '';
    let cancelled = false;

    await expect(uploadArtifact(
      input,
      'custom/kind',
      'report name.json',
      'application/json',
      new TextEncoder().encode('{}'),
      {
        fetchImpl: async (request) => {
          requestedUrl = String(request);
          return new Response(new ReadableStream({
            cancel() {
              cancelled = true;
            }
          }), { status: 503 });
        }
      }
    )).rejects.toThrow('Artifact upload failed with 503');

    expect(requestedUrl).toBe(
      'https://api.example.test/internal/browser-audits/'
      + 'audit%2Fpath%3Ftoken%3Dsecret/artifacts'
      + '?kind=custom%2Fkind&filename=report%20name.json'
    );
    expect(cancelled).toBe(true);
  });
});
