import type { BrowserAuditResource, RegionAvailability } from '@webperf/contracts';
import type { MetricGridItem } from '@webperf/ui/components/operator/types';

type ReportsAccessors = {
  getSavedChecksEnabled: () => boolean;
  getBrowserAudits: () => BrowserAuditResource[];
  getBrowserAuditDirectRunEnabled: () => boolean;
  getRegions: () => RegionAvailability[];
  refreshControlData: () => Promise<void>;
};

export class ReportsController {
  private activeSubmissionController: AbortController | null = null;
  private destroyed = false;

  state = $state({
    workspaceTab: 'browser' as 'browser' | 'browserAudits' | 'endpoints',
    browserAuditTargetUrl: '',
    browserAuditRegion: '',
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

  get browserAuditRegionOptions() {
    return this.accessors
      .getRegions()
      .filter((region) => region.selectable)
      .map((region) => ({
        value: region.code,
        label: region.label
      }));
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

    try {
      new URL(this.state.browserAuditTargetUrl);
    } catch {
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
          region: this.state.browserAuditRegion || null,
          policy: {
            preset: this.state.browserAuditPreset,
            flow: {
              steps: [{ type: 'navigate', url: this.state.browserAuditTargetUrl }]
            }
          }
        }),
        signal: submissionController.signal
      });
      const payload = (await response.json()) as BrowserAuditResource & { error?: string };

      if (!response.ok) {
        this.state.browserAuditSubmitError = payload.error ?? 'Failed to start a browser audit.';
        return;
      }

      this.state.selectedBrowserAuditId = payload.id;
      this.state.browserAuditStatusMessage = 'Browser Audit queued. Waiting for the executor result.';
      await this.accessors.refreshControlData();
      if (submissionController.signal.aborted) {
        return;
      }

      try {
        const completed = await this.waitForBrowserAudit(
          payload.id,
          submissionController.signal
        );
        if (completed) {
          await this.accessors.refreshControlData();
        }
        if (submissionController.signal.aborted) {
          return;
        }
        if (!completed) {
          this.state.browserAuditStatusMessage =
            'Browser Audit is still queued or running and will continue in the background.';
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
        this.state.browserAuditStatusMessage =
          'Browser Audit was queued; refresh Reports to follow its latest status.';
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
    timeoutMs = 180_000
  ): Promise<BrowserAuditResource | null> => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await waitForPollingInterval(signal, 1_000);
      const response = await fetch(
        `/api/control/browser-audits/${encodeURIComponent(auditId)}`,
        {
          cache: 'no-store',
          headers: { accept: 'application/json' },
          signal
        }
      );
      if (response.status === 404) {
        continue;
      }
      if (!response.ok) {
        throw new Error(`Browser Audit status request failed with HTTP ${response.status}`);
      }
      const audit = (await response.json()) as BrowserAuditResource;

      if (audit && ['succeeded', 'failed', 'cancelled'].includes(audit.status)) {
        return audit;
      }
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

const createAbortError = () => {
  const error = new Error('Browser Audit polling was cancelled');
  error.name = 'AbortError';
  return error;
};

const isAbortError = (error: unknown) =>
  error instanceof Error && error.name === 'AbortError';

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
