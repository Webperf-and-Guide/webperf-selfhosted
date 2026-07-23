import { afterEach, describe, expect, test } from 'bun:test';
import {
  BrowserAuditPollingError,
  ReportsController,
  createBrowserAuditPollingHttpError,
  isBrowserAuditTargetUrl,
  isRetryableBrowserAuditStatus,
  parseBrowserAuditResourcePayload,
  readBrowserAuditApiError,
  readBrowserAuditResponsePayload,
  recordBrowserAuditServerError
} from './reports-controller.svelte';

const originalFetch = globalThis.fetch;
const originalStateDescriptor = Object.getOwnPropertyDescriptor(globalThis, '$state');

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalStateDescriptor) {
    Object.defineProperty(globalThis, '$state', originalStateDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, '$state');
  }
});

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

  test('stops polling after repeated server errors', () => {
    let consecutiveErrors = 0;
    for (let attempt = 1; attempt < 5; attempt += 1) {
      consecutiveErrors = recordBrowserAuditServerError(consecutiveErrors);
    }
    expect(consecutiveErrors).toBe(4);
    expect(() => recordBrowserAuditServerError(consecutiveErrors))
      .toThrow('repeatedly failed due to server errors');
  });

  test('keeps queue success distinct when the initial refresh fails', async () => {
    Object.defineProperty(globalThis, '$state', {
      configurable: true,
      value: <Value>(value: Value) => value,
      writable: true
    });
    globalThis.fetch = Object.assign(
      async () => new Response(JSON.stringify({
        id: 'audit_refresh_failure',
        targetUrl: 'https://example.com/',
        region: null,
        status: 'queued',
        requestedAt: '2026-07-22T00:00:00.000Z',
        startedAt: null,
        completedAt: null,
        policy: {
          preset: 'mobile',
          flow: { steps: [{ type: 'navigate', url: 'https://example.com/' }] }
        },
        customHeaders: [],
        cookies: [],
        result: null,
        error: null
      }), {
        status: 202,
        headers: { 'content-type': 'application/json' }
      }),
      { preconnect: () => undefined }
    );
    const controller = new ReportsController({
      getSavedChecksEnabled: () => true,
      getBrowserAudits: () => [],
      getBrowserAuditDirectRunEnabled: () => true,
      getRegions: () => [],
      refreshControlData: async () => {
        throw new Error('refresh unavailable');
      }
    });
    controller.state.browserAuditTargetUrl = 'https://example.com/';

    await controller.submitBrowserAudit({
      preventDefault() {}
    } as SubmitEvent);

    expect(controller.state.selectedBrowserAuditId).toBe('audit_refresh_failure');
    expect(controller.state.browserAuditSubmitError).toBeNull();
    expect(controller.state.browserAuditStatusMessage)
      .toBe('Browser Audit was queued; refresh Reports to follow its latest status.');
    expect(controller.state.browserAuditSubmitting).toBe(false);
  });

  test('accepts only HTTP and HTTPS audit targets', () => {
    expect(isBrowserAuditTargetUrl('https://example.com/path')).toBe(true);
    expect(isBrowserAuditTargetUrl('http://example.com')).toBe(true);
    expect(isBrowserAuditTargetUrl('file:///etc/passwd')).toBe(false);
    expect(isBrowserAuditTargetUrl('data:text/html,test')).toBe(false);
    expect(isBrowserAuditTargetUrl('not a url')).toBe(false);
  });

  test('classifies non-retryable polling responses as polling failures', () => {
    const error = createBrowserAuditPollingHttpError(403);
    expect(error).toBeInstanceOf(BrowserAuditPollingError);
    expect(error.message).toBe('Browser Audit status request failed with HTTP 403');
  });

  test('normalizes malformed or empty response JSON before schema handling', async () => {
    expect(await readBrowserAuditResponsePayload(new Response('{'))).toBeNull();
    expect(await readBrowserAuditResponsePayload(new Response(null, { status: 204 }))).toBeNull();
    expect(await readBrowserAuditResponsePayload(new Response('{"ok":true}'))).toEqual({
      ok: true
    });
  });
});
