import { describe, expect, test } from 'bun:test';
import type { BrowserAuditWorkerRequest } from '@webperf/contracts';
import { createHash } from 'node:crypto';
import {
  buildChromeLaunchArgs,
  lighthouseArtifactContentTypes,
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
    expect(args).not.toContain('--no-sandbox');
  });

  test('adds no-sandbox only for the explicit degraded mode', () => {
    expect(buildChromeLaunchArgs({ allowNoSandbox: true })).toContain('--no-sandbox');
    expect(buildChromeLaunchArgs({ allowNoSandbox: false })).not.toContain('--no-sandbox');
  });

  test('keeps Lighthouse MIME types aligned with the public registry', () => {
    expect(lighthouseArtifactContentTypes).toEqual({
      html: 'text/html; charset=utf-8',
      json: 'application/json',
      screenshot: 'image/png',
      trace: 'application/json'
    });
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
        fetchImpl: responseFor(createHash('sha256').update(payload).digest('hex'))
      }
    )).resolves.toHaveLength(1);
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
});
