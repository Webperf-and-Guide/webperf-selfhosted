import { describe, expect, test } from 'bun:test';
import type { BrowserAuditWorkerRequest } from '@webperf/contracts';
import {
  redactBrowserAuditBytesInPlace,
  redactBrowserAuditText,
  redactBrowserAuditUrl
} from './redaction';

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

  test('redacts URL credentials and mutates large artifact buffers without decoding copies', () => {
    const input = {
      customHeaders: [{ name: 'Authorization', value: 'Bearer private-token' }],
      cookies: [{ name: 'session', value: 'private-cookie' }],
      artifactUpload: null
    } as BrowserAuditWorkerRequest;
    expect(
      redactBrowserAuditUrl('https://user:pass@example.com/path?token=secret#fragment', input)
    ).toBe('https://example.com/path?redacted');

    const bytes = new TextEncoder().encode(
      '{"url":"HTTPS://user:pass@example.com/path?token=secret#private-fragment","header":"Bearer private-token"}'
    );
    const redactedBytes = redactBrowserAuditBytesInPlace(bytes, input);
    const text = new TextDecoder().decode(redactedBytes);
    expect(redactedBytes).toBe(bytes);
    expect(text).not.toContain('user:pass');
    expect(text).not.toContain('token=secret');
    expect(text).not.toContain('private-fragment');
    expect(text).not.toContain('Bearer private-token');
  });
});
