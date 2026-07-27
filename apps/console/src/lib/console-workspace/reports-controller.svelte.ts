import {
  browserAuditResourceSchema,
  isBrowserAuditTerminalExecutionStatus,
  type BrowserAuditExecutionStatus,
  type BrowserAuditResource
} from '@webperf/contracts';
import type { MetricGridItem } from '@webperf/ui/components/operator/types';

const browserAuditPollingTimeoutMs = 180_000;
const browserAuditStatusRequestTimeoutMs = 15_000;
const browserAuditInitialPollingIntervalMs = 1_000;
const browserAuditMaximumPollingIntervalMs = 5_000;
const browserAuditPollingBackoffMultiplier = 1.5;
const browserAuditMaximumNotFoundResponses = 5;
const browserAuditMaximumServerErrorResponses = 5;
const maximumBrowserAuditApiErrorLength = 500;

const createAbortError = () => {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Browser Audit polling was cancelled', 'AbortError');
  }

  return Object.assign(new Error('Browser Audit polling was cancelled'), {
    name: 'AbortError'
  });
};

const isAbortError = (error: unknown) =>
  typeof error === 'object'
  && error !== null
  && 'name' in error
  && error.name === 'AbortError';

const isTimeoutError = (error: unknown) =>
  typeof error === 'object'
  && error !== null
  && 'name' in error
  && error.name === 'TimeoutError';

export class BrowserAuditPollingError extends Error {
  override name = 'BrowserAuditPollingError';
}

class BrowserAuditProtocolError extends Error {
  override name = 'BrowserAuditProtocolError';
}

export const parseBrowserAuditResourcePayload = (value: unknown) => {
  const parsed = browserAuditResourceSchema.safeParse(value);
  if (!parsed.success) {
    throw new BrowserAuditProtocolError('Browser Audit API returned an invalid response.');
  }
  return parsed.data;
};

export const readBrowserAuditApiError = (value: unknown, fallback: string) => {
  if (!value || typeof value !== 'object' || !('error' in value)) {
    return fallback;
  }
  const error = value.error;
  if (typeof error !== 'string') {
    return fallback;
  }
  const normalized = error.trim();
  return normalized.length > 0 && normalized.length <= maximumBrowserAuditApiErrorLength
    ? normalized
    : fallback;
};

export const isRetryableBrowserAuditStatus = (status: number) =>
  status >= 500 && status <= 599;

export const recordBrowserAuditServerError = (consecutiveErrors: number) => {
  const nextConsecutiveErrors = consecutiveErrors + 1;
  if (nextConsecutiveErrors >= browserAuditMaximumServerErrorResponses) {
    throw new BrowserAuditPollingError(
      'Browser Audit status checks repeatedly failed due to server errors.'
    );
  }
  return nextConsecutiveErrors;
};

export const isBrowserAuditTargetUrl = (value: string) => {
  try {
    const target = new URL(value);
    return target.protocol === 'http:' || target.protocol === 'https:';
  } catch {
    return false;
  }
};

export const createBrowserAuditPollingHttpError = (status: number) =>
  new BrowserAuditPollingError(
    `Browser Audit status request failed with HTTP ${status}`
  );

export const describeBrowserAuditTerminalRefreshFailure = (
  status: BrowserAuditExecutionStatus
) => status === 'succeeded'
  ? 'Browser Audit completed, but Reports could not refresh. Refresh to see recent history.'
  : `Browser Audit finished with status ${status}, but Reports could not refresh. Refresh to see details.`;

export const readBrowserAuditResponsePayload = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

export const fetchBrowserAuditStatus = async ({
  auditId,
  signal,
  timeoutMs,
  fetchImpl = fetch
}: {
  auditId: string;
  signal: AbortSignal;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}) => {
  const requestSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(timeoutMs)
  ]);
  try {
    return await fetchImpl(
      `/api/control/browser-audits/${encodeURIComponent(auditId)}`,
      {
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: requestSignal
      }
    );
  } catch (error) {
    if (signal.aborted) {
      throw isAbortError(signal.reason) ? signal.reason : createAbortError();
    }
    if (requestSignal.aborted && isTimeoutError(requestSignal.reason)) {
      throw new BrowserAuditPollingError('Browser Audit status request timed out.');
    }
    throw error;
  }
};

const discardResponseBody = async (response: Response) => {
  if (!response.body) {
    return;
  }
  try {
    await response.body.cancel();
  } catch {
    // A locked or already-consumed body has no remaining connection resource to release here.
  }
};

const waitForPollingInterval = (signal: AbortSignal, timeoutMs: number) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(isAbortError(signal.reason) ? signal.reason : createAbortError());
      return;
    }

    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, timeoutMs);
    const abort = () => {
      clearTimeout(timeout);
      reject(isAbortError(signal.reason) ? signal.reason : createAbortError());
    };
    signal.addEventListener('abort', abort, { once: true });
  });

const nextPollingInterval = (current: number) => Math.min(
  browserAuditMaximumPollingIntervalMs,
  Math.ceil(current * browserAuditPollingBackoffMultiplier)
);

type ReportsAccessors = {
  getSavedChecksEnabled: () => boolean;
  getBrowserAudits: () => BrowserAuditResource[];
  getBrowserAuditDirectRunEnabled: () => boolean;
  refreshControlData: () => Promise<void>;
};

export class ReportsController {
  private activeSubmissionController: AbortController | null = null;
  private destroyed = false;

  state = $state({
    workspaceTab: 'browser' as 'browser' | 'browserAudits' | 'endpoints',
    browserAuditTargetUrl: '',
    // Phase 1 of issue #14: Browser Audit region selection was removed.
    // Audits run from the deployment's single runtime location, so the
    // server stamps the region id automatically.
    browserAuditPreset: 'mobile' as 'mobile' | 'desktop',
    browserAuditSubmitting: false,
    browserAuditSubmitError: null as string | null,
    browserAuditStatusMessage: null as string | null,
    selectedBrowserAuditId: null as string | null
  });

  constructor(private readonly accessors: ReportsAccessors) {}

  get savedChecksEnabled() {
    return this.accessors.getSavedChecksEnabled();
  }

  get browserAudits() {
    return this.accessors.getBrowserAudits();
  }

  get browserAuditDirectRunEnabled() {
    return this.accessors.getBrowserAuditDirectRunEnabled();
  }

  // Region selection was removed; the option list stays empty so existing
  // markup that binds to it continues to render without offering a choice.
  get browserAuditRegionOptions() {
    return [] as Array<{ value: string; label: string }>;
  }

  get selectedBrowserAudit() {
    return (
      this.browserAudits.find((audit) => audit.id === this.state.selectedBrowserAuditId)
      ?? this.browserAudits[0]
      ?? null
    );
  }

  get summaryItems(): MetricGridItem[] {
    return [
      {
        id: 'comparisons',
        label: 'Comparisons',
        value: 'Latest vs previous and baseline',
        detail: 'Keep regressions, improvements, and unchanged routes isolated from configuration.'
      },
      {
        id: 'exports',
        label: 'Exports',
        value: 'JSON and CSV',
        detail: 'Send deterministic report payloads to CI artifacts, handoffs, or incident notes.'
      },
      {
        id: 'browser',
        label: 'Derived resources',
        value: 'Report browser',
        detail: 'Browse persisted comparisons and exports without leaving the operator workspace.'
      },
      {
        id: 'browser-audits',
        label: 'Browser audits',
        value: this.browserAuditDirectRunEnabled
          ? `${this.browserAudits.length} recent audits`
          : 'Optional runtime',
        detail: this.browserAuditDirectRunEnabled
          ? 'Queue browser audits and review their saved results in one place.'
          : 'Enable the optional runner to unlock queued browser audits.'
      }
    ];
  }

  selectBrowserAudit = (auditId: string) => {
    this.state.selectedBrowserAuditId = auditId;
    this.state.browserAuditStatusMessage = null;
  };

  submitBrowserAudit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (this.destroyed) {
      return;
    }
    this.state.browserAuditSubmitError = null;
    this.state.browserAuditStatusMessage = null;

    if (!isBrowserAuditTargetUrl(this.state.browserAuditTargetUrl)) {
      this.state.browserAuditSubmitError = 'Enter a valid URL to audit.';
      return;
    }

    if (!this.browserAuditDirectRunEnabled) {
      this.state.browserAuditSubmitError = 'Browser Audit is not configured for this self-host install.';
      return;
    }

    this.state.browserAuditSubmitting = true;
    this.activeSubmissionController?.abort(createAbortError());
    const submissionController = new AbortController();
    this.activeSubmissionController = submissionController;

    try {
      const response = await fetch('/api/control/browser-audits', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          targetUrl: this.state.browserAuditTargetUrl,
          policy: {
            preset: this.state.browserAuditPreset,
            flow: {
              steps: [{ type: 'navigate', url: this.state.browserAuditTargetUrl }]
            }
          }
        }),
        signal: submissionController.signal
      });
      const rawPayload = await readBrowserAuditResponsePayload(response);

      if (!response.ok) {
        this.state.browserAuditSubmitError = readBrowserAuditApiError(
          rawPayload,
          'Failed to start a browser audit.'
        );
        return;
      }
      const payload = parseBrowserAuditResourcePayload(rawPayload);

      this.state.selectedBrowserAuditId = payload.id;
      this.state.browserAuditStatusMessage = 'Browser Audit queued. Waiting for the executor result.';
      try {
        await this.accessors.refreshControlData();
      } catch (error) {
        if (isAbortError(error) || submissionController.signal.aborted) {
          return;
        }
        this.state.browserAuditStatusMessage =
          'Browser Audit was queued; refresh Reports to follow its latest status.';
        return;
      }
      if (submissionController.signal.aborted) {
        return;
      }

      try {
        const completed = await this.waitForBrowserAudit(
          payload.id,
          submissionController.signal
        );
        if (completed) {
          try {
            await this.accessors.refreshControlData();
          } catch (error) {
            if (isAbortError(error) || submissionController.signal.aborted) {
              return;
            }
            this.state.browserAuditStatusMessage =
              describeBrowserAuditTerminalRefreshFailure(completed.status);
            return;
          }
        }
        if (submissionController.signal.aborted) {
          return;
        }
        if (!completed) {
          this.state.browserAuditStatusMessage =
            'Browser Audit is still queued or running. Refresh Reports to see the latest status.';
        } else if (completed.status === 'succeeded') {
          this.state.browserAuditStatusMessage =
            'Browser Audit completed and was saved to recent history.';
        } else {
          this.state.browserAuditStatusMessage =
            `Browser Audit finished with status ${completed.status}; inspect the saved details.`;
        }
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        this.state.browserAuditStatusMessage = error instanceof BrowserAuditPollingError
          ? error.message
          : 'Browser Audit was queued; refresh Reports to follow its latest status.';
      }
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      this.state.browserAuditSubmitError =
        error instanceof Error ? error.message : 'Failed to start a browser audit.';
    } finally {
      if (this.activeSubmissionController === submissionController) {
        this.activeSubmissionController = null;
        if (!this.destroyed) {
          this.state.browserAuditSubmitting = false;
        }
      }
    }
  };

  private waitForBrowserAudit = async (
    auditId: string,
    signal: AbortSignal,
    timeoutMs = browserAuditPollingTimeoutMs
  ): Promise<BrowserAuditResource | null> => {
    const deadline = Date.now() + timeoutMs;
    let consecutiveNotFound = 0;
    let consecutiveServerErrors = 0;
    let pollingIntervalMs = browserAuditInitialPollingIntervalMs;
    let previousStatus: BrowserAuditExecutionStatus | null = null;

    while (Date.now() < deadline) {
      const remainingBeforeWaitMs = deadline - Date.now();
      await waitForPollingInterval(
        signal,
        Math.min(pollingIntervalMs, remainingBeforeWaitMs)
      );
      const remainingRequestMs = deadline - Date.now();
      if (remainingRequestMs <= 0) {
        break;
      }
      const response = await fetchBrowserAuditStatus({
        auditId,
        signal,
        timeoutMs: Math.min(browserAuditStatusRequestTimeoutMs, remainingRequestMs)
      });
      if (response.status === 404) {
        await discardResponseBody(response);
        consecutiveNotFound += 1;
        consecutiveServerErrors = 0;
        previousStatus = null;
        if (consecutiveNotFound >= browserAuditMaximumNotFoundResponses) {
          throw new BrowserAuditPollingError(
            'Browser Audit could not be found after repeated status checks.'
          );
        }
        pollingIntervalMs = nextPollingInterval(pollingIntervalMs);
        continue;
      }
      consecutiveNotFound = 0;
      if (isRetryableBrowserAuditStatus(response.status)) {
        await discardResponseBody(response);
        consecutiveServerErrors = recordBrowserAuditServerError(
          consecutiveServerErrors
        );
        pollingIntervalMs = nextPollingInterval(pollingIntervalMs);
        continue;
      }
      consecutiveServerErrors = 0;
      if (!response.ok) {
        await discardResponseBody(response);
        throw createBrowserAuditPollingHttpError(response.status);
      }
      const audit = parseBrowserAuditResourcePayload(
        await readBrowserAuditResponsePayload(response)
      );

      if (isBrowserAuditTerminalExecutionStatus(audit.status)) {
        return audit;
      }
      pollingIntervalMs = audit.status === previousStatus
        ? nextPollingInterval(pollingIntervalMs)
        : browserAuditInitialPollingIntervalMs;
      previousStatus = audit.status;
    }

    return null;
  };

  destroy() {
    this.destroyed = true;
    this.activeSubmissionController?.abort(createAbortError());
    this.activeSubmissionController = null;
  }
}

export const createReportsController = (accessors: ReportsAccessors) =>
  new ReportsController(accessors);
