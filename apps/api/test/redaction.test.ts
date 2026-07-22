import { describe, expect, test } from 'bun:test';
import {
  isSensitiveHeaderName,
  redactJsonResponse,
  redactSensitiveData,
  redactUrlQuery,
  redactUrlsInText,
  redactedValue
} from '../src/redaction';

describe('API secret redaction', () => {
  test('recognizes exact and token-like sensitive header names', () => {
    expect(isSensitiveHeaderName('Authorization')).toBe(true);
    expect(isSensitiveHeaderName('X-API-Key')).toBe(true);
    expect(isSensitiveHeaderName('x-release-token')).toBe(true);
    expect(isSensitiveHeaderName('x-client-password')).toBe(true);
    expect(isSensitiveHeaderName('x-cache-keyspace')).toBe(false);
  });

  test('masks sensitive headers, cookies, and webhook secrets', () => {
    expect(
      redactSensitiveData({
        headers: [
          { name: 'Authorization', value: 'Bearer private' },
          { name: 'Accept-Language', value: 'ko-KR' }
        ],
        cookies: [{ name: 'session', value: 'private-cookie' }],
        webhookTargets: [{ name: 'primary', secret: 'private-signature' }],
        clientSecret: 'private-client-secret',
        uploadToken: 'private-upload-token',
        bearerToken: 'private-bearer-token',
        privateKey: 'private-key',
        keyVersion: 'current'
      })
    ).toEqual({
      headers: [
        { name: 'Authorization', value: redactedValue },
        { name: 'Accept-Language', value: 'ko-KR' }
      ],
      cookies: [{ name: 'session', value: redactedValue }],
      webhookTargets: [{ name: 'primary', secret: redactedValue }],
      clientSecret: redactedValue,
      uploadToken: redactedValue,
      bearerToken: redactedValue,
      privateKey: redactedValue,
      keyVersion: 'current'
    });
  });

  test('removes query values and fragments from URLs', () => {
    expect(redactUrlQuery('https://example.com/path?token=private#fragment')).toBe(
      'https://example.com/path?redacted'
    );
    expect(redactUrlQuery('https://user:pass@example.com/path')).toBe('https://example.com/path');
    expect(redactUrlQuery('/relative/path?token=private#fragment')).toBe('/relative/path?redacted');
    expect(redactUrlsInText('failed for https://example.com/path?token=private')).toBe(
      'failed for https://example.com/path?redacted'
    );
  });

  test('drops stale content length when a JSON response body cannot be parsed', async () => {
    const response = new Response('not-json', {
      headers: {
        'content-type': 'application/json',
        'content-length': '100'
      }
    });
    const redacted = await redactJsonResponse(response);
    expect(redacted.headers.get('content-length')).toBeNull();
    expect(await redacted.text()).toBe('not-json');
  });
});
