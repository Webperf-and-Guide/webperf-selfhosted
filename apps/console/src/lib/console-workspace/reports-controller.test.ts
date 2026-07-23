import { describe, expect, test } from 'bun:test';
import {
  isRetryableBrowserAuditStatus,
  parseBrowserAuditResourcePayload,
  readBrowserAuditApiError,
  readBrowserAuditResponsePayload
} from './reports-controller.svelte';

describe('Reports Browser Audit response handling', () => {
  test('rejects malformed successful resources with a stable protocol error', () => {
    expect(() => parseBrowserAuditResourcePayload({ status: 'queued' }))
      .toThrow('Browser Audit API returned an invalid response.');
    expect(() => parseBrowserAuditResourcePayload({ secret: 'must-not-appear' }))
      .toThrow('Browser Audit API returned an invalid response.');
  });

  test('accepts only bounded string error messages from failed responses', () => {
    const fallback = 'Failed to start a browser audit.';
    expect(readBrowserAuditApiError({ error: ' Try again. ' }, fallback)).toBe('Try again.');
    expect(readBrowserAuditApiError({ error: 500 }, fallback)).toBe(fallback);
    expect(readBrowserAuditApiError({ error: 'x'.repeat(501) }, fallback)).toBe(fallback);
    expect(readBrowserAuditApiError(null, fallback)).toBe(fallback);
  });

  test('retries only server errors during polling', () => {
    expect(isRetryableBrowserAuditStatus(500)).toBe(true);
    expect(isRetryableBrowserAuditStatus(503)).toBe(true);
    expect(isRetryableBrowserAuditStatus(599)).toBe(true);
    expect(isRetryableBrowserAuditStatus(404)).toBe(false);
    expect(isRetryableBrowserAuditStatus(429)).toBe(false);
  });

  test('normalizes malformed or empty response JSON before schema handling', async () => {
    expect(await readBrowserAuditResponsePayload(new Response('{'))).toBeNull();
    expect(await readBrowserAuditResponsePayload(new Response(null, { status: 204 }))).toBeNull();
    expect(await readBrowserAuditResponsePayload(new Response('{"ok":true}'))).toEqual({
      ok: true
    });
  });
});
