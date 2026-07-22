import { describe, expect, test } from 'bun:test';
import { browserAuditWorkerRequestSchema } from '@webperf/contracts';
import { createBrowserAuditSignature } from '../src/index';

describe('Browser Audit request signatures', () => {
  test('binds the transient artifact bearer token into the runner request signature', async () => {
    const parsed = browserAuditWorkerRequestSchema.parse({
      executionId: 'audit_signature',
      targetUrl: 'https://example.com/',
      region: null,
      policy: {
        preset: 'mobile',
        flow: { steps: [{ type: 'navigate', url: 'https://example.com/' }] }
      },
      customHeaders: [],
      cookies: [],
      artifactUpload: {
        baseUrl: 'http://127.0.0.1:8788',
        bearerToken: 'artifact-token-one',
        expiresAt: '2099-07-22T00:15:00.000Z',
        maxArtifactBytes: 25_000_000,
        allowedContentTypes: ['application/json', 'text/html']
      },
      timestamp: '2026-07-22T00:00:00.000Z',
      signature: 'a',
      keyVersion: 'current'
    });
    const { signature: _signature, ...unsigned } = parsed;
    const changedToken = {
      ...unsigned,
      artifactUpload: unsigned.artifactUpload
        ? { ...unsigned.artifactUpload, bearerToken: 'artifact-token-two' }
        : null
    };

    expect(await createBrowserAuditSignature('browser-signature-secret', unsigned))
      .not.toBe(await createBrowserAuditSignature('browser-signature-secret', changedToken));
  });
});
