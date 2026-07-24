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
        bearerToken: 'private-upload-token',
        expiresAt: '2026-07-22T12:15:00.000Z',
        maxArtifactBytes: 25_000_000,
        allowedContentTypes: ['application/json', 'text/html']
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
    expect(
      redactBrowserAuditUrl('https://user:p@ss@exa[mple.test/path', input)
    ).toBe('https://[REDACTED]@exa[mple.test/path');

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

  test('redacts adjacent and malformed URLs without losing comma-path query coverage', () => {
    const input = {
      customHeaders: [],
      cookies: [],
      artifactUpload: null
    } as unknown as BrowserAuditWorkerRequest;
    const redacted = redactBrowserAuditText(
      [
        'https://first:user@a.example/?token=one,https://second:user@b.example/?token=two)',
        'https://example.com/a,b?token=three',
        'https://broken:user@exa[mple.test/?token=four'
      ].join(' '),
      input
    );

    for (const secret of ['first:user', 'second:user', 'token=one', 'token=two', 'token=three', 'broken:user', 'token=four']) {
      expect(redacted).not.toContain(secret);
    }

    const bytes = new TextEncoder().encode(
      'https://first:user@a.example/?token=one,https://second:user@b.example/?token=two'
    );
    const redactedBytes = new TextDecoder().decode(
      redactBrowserAuditBytesInPlace(bytes, input)
    );
    expect(redactedBytes).not.toContain('first:user');
    expect(redactedBytes).not.toContain('second:user');
    expect(redactedBytes).not.toContain('token=one');
    expect(redactedBytes).not.toContain('token=two');
  });

  test('redacts short values only in string and named credential contexts', () => {
    const input = {
      customHeaders: [
        { name: 'Authorization', value: '1' },
        { name: 'X-Code', value: 'abc' }
      ],
      cookies: [{ name: 'session', value: 'ok' }],
      artifactUpload: null
    } as BrowserAuditWorkerRequest;
    const source = '{"score":1,"header":"1","cookie":"ok","word":"101","lower":"abc","upper":"ABC"}\nAuthorization:\t1 session =  ok X-CODE: abc x-code: ABC';
    const redacted = redactBrowserAuditText(source, input);

    expect(redacted).toContain('"score":1');
    expect(redacted).toContain('"word":"101"');
    expect(redacted).toContain('"upper":"ABC"');
    expect(redacted).not.toContain('"header":"1"');
    expect(redacted).not.toContain('"cookie":"ok"');
    expect(redacted).not.toContain('Authorization:\t1');
    expect(redacted).not.toContain('session =  ok');
    expect(redacted).not.toContain('X-CODE: abc');
    expect(redacted).toContain('x-code: ABC');

    const bytes = new TextEncoder().encode(source);
    const byteText = new TextDecoder().decode(redactBrowserAuditBytesInPlace(bytes, input));
    expect(byteText).toContain('"score":1');
    expect(byteText).toContain('"word":"101"');
    expect(byteText).toContain('"upper":"ABC"');
    expect(byteText).toContain('"header":"*"');
    expect(byteText).toContain('"cookie":"**"');
    expect(byteText).not.toContain('Authorization:\t1');
    expect(byteText).not.toContain('session =  ok');
    expect(byteText).not.toContain('X-CODE: abc');
    expect(byteText).toContain('x-code: ABC');
  });

  test('redacts short artifact bearer tokens in named authorization contexts', () => {
    const input = {
      customHeaders: [],
      cookies: [],
      artifactUpload: {
        baseUrl: 'http://api:8788',
        bearerToken: 'abc',
        expiresAt: '2026-07-22T12:15:00.000Z',
        maxArtifactBytes: 25_000_000,
        allowedContentTypes: ['application/json']
      }
    } as unknown as BrowserAuditWorkerRequest;
    const source = 'Authorization: Bearer abc bearerToken=abc unrelated=abc';
    const redactedText = redactBrowserAuditText(source, input);
    const redactedBytes = new TextDecoder().decode(
      redactBrowserAuditBytesInPlace(new TextEncoder().encode(source), input)
    );

    for (const redacted of [redactedText, redactedBytes]) {
      expect(redacted).not.toContain('Bearer abc');
      expect(redacted).not.toContain('bearerToken=abc');
      expect(redacted).toContain('unrelated=abc');
    }
  });

  test('ignores malformed empty credential names in both redaction paths', () => {
    const input = {
      customHeaders: [{ name: '', value: 'ok' }],
      cookies: [],
      artifactUpload: null
    } as unknown as BrowserAuditWorkerRequest;
    const source = 'status:ok count=ok';

    expect(redactBrowserAuditText(source, input)).toBe(source);
    expect(new TextDecoder().decode(
      redactBrowserAuditBytesInPlace(new TextEncoder().encode(source), input)
    )).toBe(source);
  });

  test('keeps short credential boundaries and ASCII whitespace aligned in both paths', () => {
    const input = {
      customHeaders: [{ name: 'X-Code', value: 'abc' }],
      cookies: [{ name: 'sid', value: 'ok' }],
      artifactUpload: null
    } as BrowserAuditWorkerRequest;
    const source = 'X-Code\v:\fabc/host sid=ok@domain X-Code:abc_suffix sid=okay';

    const redactedText = redactBrowserAuditText(source, input);
    const redactedBytes = new TextDecoder().decode(
      redactBrowserAuditBytesInPlace(new TextEncoder().encode(source), input)
    );

    for (const redacted of [redactedText, redactedBytes]) {
      expect(redacted).not.toContain('abc/host');
      expect(redacted).not.toContain('ok@domain');
      expect(redacted).toContain('X-Code:abc_suffix');
      expect(redacted).toContain('sid=okay');
    }
  });

  test('continues redacting quoted short values after an unmatched quote', () => {
    const input = {
      customHeaders: [{ name: 'X-Code', value: 'abc' }],
      cookies: [{ name: 'sid', value: 'ok' }],
      artifactUpload: null
    } as BrowserAuditWorkerRequest;
    const source = 'stray " prefix then \'abc\' and \'ok\'';

    const redactedText = redactBrowserAuditText(source, input);
    const redactedBytes = new TextDecoder().decode(
      redactBrowserAuditBytesInPlace(new TextEncoder().encode(source), input)
    );

    expect(redactedText).not.toContain("'abc'");
    expect(redactedText).not.toContain("'ok'");
    expect(redactedBytes).not.toContain("'abc'");
    expect(redactedBytes).not.toContain("'ok'");
  });
});
