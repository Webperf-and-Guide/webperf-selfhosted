import { describe, expect, test } from 'bun:test';
import {
  isSensitiveHeaderName,
  maxRedactedJsonResponseBytes,
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
    expect(isSensitiveHeaderName('apikey')).toBe(true);
    expect(isSensitiveHeaderName('AccessToken')).toBe(true);
    expect(isSensitiveHeaderName('csrfToken')).toBe(true);
    expect(isSensitiveHeaderName('sessiontoken')).toBe(true);
    expect(isSensitiveHeaderName('x-cache-keyspace')).toBe(false);
  });

  test('bounds recursive redaction and replaces circular references', () => {
    const circular: Record<string, unknown> = { token: 'private-token' };
    circular.self = circular;

    expect(redactSensitiveData(circular)).toEqual({
      token: redactedValue,
      self: redactedValue
    });

    let nested: Record<string, unknown> = { secret: 'private-secret' };
    for (let index = 0; index < 40; index += 1) {
      nested = { child: nested };
    }
    expect(JSON.stringify(redactSensitiveData(nested))).toContain(redactedValue);
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

  test('fails closed when a JSON response cannot be safely redacted', async () => {
    const response = new Response('not-json', {
      headers: {
        'content-type': 'application/json',
        'content-length': '100',
        'access-control-allow-origin': 'https://console.example.test',
        'x-webperf-metadata': 'preserved',
        'x-api-key': 'private-response-key'
      }
    });
    const redacted = await redactJsonResponse(response);
    expect(redacted.headers.get('content-length')).toBeNull();
    expect(redacted.headers.get('access-control-allow-origin'))
      .toBe('https://console.example.test');
    expect(redacted.headers.get('x-webperf-metadata')).toBe('preserved');
    expect(redacted.headers.get('x-api-key')).toBeNull();
    expect(redacted.status).toBe(500);
    expect(await redacted.json()).toEqual({ error: 'Response was not valid JSON' });

    const oversized = await redactJsonResponse(new Response('{"token":"private"}', {
      headers: {
        'content-type': 'application/json',
        'content-length': String(maxRedactedJsonResponseBytes + 1)
      }
    }));
    expect(oversized.status).toBe(500);
    expect(await oversized.json()).toEqual({
      error: 'Response exceeded the safe redaction byte limit'
    });
  });
});
