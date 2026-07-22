import { describe, expect, test } from 'bun:test';
import type { BrowserAuditWorkerRequest } from '@webperf/contracts';
import { redactBrowserAuditText } from './redaction';

describe('browser audit redaction', () => {
  test('removes execution secrets and URL query values from artifact text', () => {
    const input = {
      customHeaders: [{ name: 'Authorization', value: 'Bearer private-token' }],
      cookies: [{ name: 'session', value: 'private-cookie' }],
      artifactUpload: {
        baseUrl: 'http://api:8788',
        bearerToken: 'private-upload-token'
      }
    } as BrowserAuditWorkerRequest;

    expect(
      redactBrowserAuditText(
        'Bearer private-token private-cookie private-upload-token https://example.com/?token=secret',
        input
      )
    ).toBe('[REDACTED] [REDACTED] [REDACTED] https://example.com/?redacted');
  });
});
