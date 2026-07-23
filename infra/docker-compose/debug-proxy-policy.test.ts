import { describe, expect, test } from 'bun:test';
import {
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
});
