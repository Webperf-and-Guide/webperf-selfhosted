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
    expect(isSensitiveHeaderName('xsecret')).toBe(true);
    expect(isSensitiveHeaderName('xpassword')).toBe(true);
    expect(isSensitiveHeaderName('xkey')).toBe(true);
    expect(isSensitiveHeaderName('x-cache-keyspace')).toBe(false);
    expect(isSensitiveHeaderName('xmonkey')).toBe(false);
  });

  test('preserves JSON reserved keys without changing the redacted object prototype', () => {
    const source = JSON.parse(
      '{"__proto__":{"token":"private"},"constructor":"kept","prototype":"kept"}'
    );
    const redacted = redactSensitiveData(source) as Record<string, unknown>;

    expect(Object.getPrototypeOf(redacted)).toBeNull();
    expect(Object.hasOwn(redacted, '__proto__')).toBe(true);
    expect(JSON.parse(JSON.stringify(redacted))).toEqual(JSON.parse(
      `{"__proto__":{"token":"${redactedValue}"},"constructor":"kept","prototype":"kept"}`
    ));
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
        authorization: 'Bearer private-authorization',
        oauth_token: 'private-oauth-token',
        github_token: 'private-github-token',
        slack_token: 'private-slack-token',
        api_token: 'private-api-token',
        tokenData: { value: 'private-token-data' },
        secretConfig: 'private-secret-config',
        passwordHash: 'private-password-hash',
        keyStore: 'private-key-store',
        privateKey: 'private-key',
        publicKey: 'public-key-identifier',
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
      authorization: redactedValue,
      oauth_token: redactedValue,
      github_token: redactedValue,
      slack_token: redactedValue,
      api_token: redactedValue,
      tokenData: redactedValue,
      secretConfig: redactedValue,
      passwordHash: redactedValue,
      keyStore: redactedValue,
      privateKey: redactedValue,
      publicKey: 'public-key-identifier',
      keyVersion: 'current'
    });
  });

  test('fails closed for credential-bearing error and message text', () => {
    expect(redactSensitiveData({
      error: 'Authentication failed for token sk-abc123',
      message: 'Access denied for password admin123',
      safeMessage: 'Probe timed out',
      detail: 'Failed for https://example.com/path?token=private#fragment'
    })).toEqual({
      error: `Authentication failed for token ${redactedValue}`,
      message: `Access denied for password ${redactedValue}`,
      safeMessage: 'Probe timed out',
      detail: 'Failed for https://example.com/path?redacted'
    });

    expect(redactSensitiveData({
      error: 'Failed for https://example.com/path?token=private#fragment'
    })).toEqual({
      error: 'Failed for https://example.com/path?redacted'
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
        'content-md5': 'stale-digest',
        'access-control-allow-origin': 'https://console.example.test',
        'x-webperf-metadata': 'preserved',
        'x-api-key': 'private-response-key'
      }
    });
    const redacted = await redactJsonResponse(response);
    expect(redacted.headers.get('content-length')).toBeNull();
    expect(redacted.headers.get('content-md5')).toBeNull();
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

    const overflowingLength = await redactJsonResponse(new Response('{"ok":true}', {
      headers: {
        'content-type': 'application/json',
        'content-length': '9'.repeat(400)
      }
    }));
    expect(overflowingLength.status).toBe(500);
    expect(await overflowingLength.json()).toEqual({
      error: 'Response exceeded the safe redaction byte limit'
    });

    const lockedResponse = new Response('{"token":"private"}', {
      headers: { 'content-type': 'application/json' }
    });
    const reader = lockedResponse.body!.getReader();
    const locked = await redactJsonResponse(lockedResponse);
    reader.releaseLock();
    expect(locked.status).toBe(500);
    expect(await locked.json()).toEqual({
      error: 'Response body could not be read safely'
    });
  });
});
