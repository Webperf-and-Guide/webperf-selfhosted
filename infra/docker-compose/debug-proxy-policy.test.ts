import { describe, expect, test } from 'bun:test';
import {
  DebugProxyRequestBodyTooLargeError,
  readBoundedDebugProxyBody,
  resolveDebugProxyUpstream,
  stripHopByHopHeaders
} from './debug-proxy-policy';

describe('debug proxy policy', () => {
  test('keeps protocol-relative request paths on the configured origin', () => {
    const upstream = resolveDebugProxyUpstream(
      new URL('http://api:8788/'),
      new URL('http://127.0.0.1:8789//attacker.example.test/path?probe=1')
    );

    expect(upstream.origin).toBe('http://api:8788');
    expect(upstream.pathname).toBe('//attacker.example.test/path');
    expect(upstream.search).toBe('?probe=1');
  });

  test('removes standard and connection-declared hop-by-hop headers', () => {
    const headers = new Headers({
      connection: 'keep-alive, x-remove-me',
      'keep-alive': 'timeout=5',
      'transfer-encoding': 'chunked',
      'x-remove-me': 'unsafe',
      'x-preserve-me': 'safe'
    });

    stripHopByHopHeaders(headers);

    expect(Object.fromEntries(headers)).toEqual({ 'x-preserve-me': 'safe' });
  });

  test('reads request bodies at the byte limit', async () => {
    const request = new Request('http://127.0.0.1:8789/v1/jobs', {
      method: 'POST',
      body: '12345678'
    });

    const body = await readBoundedDebugProxyBody(request, 8);

    expect(new TextDecoder().decode(body)).toBe('12345678');
  });

  test('rejects declared and streamed request bodies above the byte limit', async () => {
    const declared = new Request('http://127.0.0.1:8789/v1/jobs', {
      method: 'POST',
      headers: { 'content-length': '9' },
      body: '123456789'
    });
    await expect(readBoundedDebugProxyBody(declared, 8))
      .rejects.toBeInstanceOf(DebugProxyRequestBodyTooLargeError);

    const streamed = new Request('http://127.0.0.1:8789/v1/jobs', {
      method: 'POST',
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('1234'));
          controller.enqueue(new TextEncoder().encode('56789'));
          controller.close();
        }
      })
    });
    await expect(readBoundedDebugProxyBody(streamed, 8))
      .rejects.toBeInstanceOf(DebugProxyRequestBodyTooLargeError);
  });
});
