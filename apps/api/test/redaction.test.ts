import { describe, expect, test } from 'bun:test';
import {
  isSensitiveHeaderName,
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
        webhookTargets: [{ name: 'primary', secret: 'private-signature' }]
      })
    ).toEqual({
      headers: [
        { name: 'Authorization', value: redactedValue },
        { name: 'Accept-Language', value: 'ko-KR' }
      ],
      cookies: [{ name: 'session', value: redactedValue }],
      webhookTargets: [{ name: 'primary', secret: redactedValue }]
    });
  });

  test('removes query values and fragments from URLs', () => {
    expect(redactUrlQuery('https://example.com/path?token=private#fragment')).toBe(
      'https://example.com/path?redacted'
    );
    expect(redactUrlsInText('failed for https://example.com/path?token=private')).toBe(
      'failed for https://example.com/path?redacted'
    );
  });
});
