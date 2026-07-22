import { describe, expect, test } from 'bun:test';
import { isRetryableHttpStatus, retryDelayMs, throwIfAborted } from './execution-utils';
import { ExecutionFailure } from './runner';

describe('execution handler utilities', () => {
  test('classifies transient HTTP statuses and applies bounded retry jitter', () => {
    expect(isRetryableHttpStatus(408)).toBe(true);
    expect(isRetryableHttpStatus(429)).toBe(true);
    expect(isRetryableHttpStatus(503)).toBe(true);
    expect(isRetryableHttpStatus(400)).toBe(false);
    expect(retryDelayMs(1, () => 0)).toBe(900);
    expect(retryDelayMs(1, () => 1)).toBe(1_100);
    expect(retryDelayMs(20, () => 1)).toBe(60_000);
  });

  test('preserves an abort reason and supplies a safe fallback', () => {
    const reason = new Error('lease expired');
    const withReason = new AbortController();
    withReason.abort(reason);
    expect(() => throwIfAborted(withReason.signal)).toThrow(reason);

    const withoutReason = new AbortController();
    withoutReason.abort('unsafe raw reason');
    expect(() => throwIfAborted(withoutReason.signal)).toThrow(ExecutionFailure);
  });
});
