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
          ? `${this.browserAudits.length} recent direct runs`
          : 'Optional runtime',
        detail: this.browserAuditDirectRunEnabled
          ? 'Launch direct-run browser audits and review artifact metadata in one place.'
          : 'Enable the optional worker to unlock direct-run browser audits.'
      }
    ];
  }

  selectBrowserAudit = (auditId: string) => {
    this.state.selectedBrowserAuditId = auditId;
    this.state.browserAuditStatusMessage = null;
  };

  submitBrowserAudit = async (event: SubmitEvent) => {
    event.preventDefault();
    this.state.browserAuditSubmitError = null;
    this.state.browserAuditStatusMessage = null;

    try {
      new URL(this.state.browserAuditTargetUrl);
    } catch {
      this.state.browserAuditSubmitError = 'Enter a valid URL to audit.';
      return;
    }

    if (!this.browserAuditDirectRunEnabled) {
      this.state.browserAuditSubmitError = 'Browser audit direct-run is not configured for this self-host install.';
      return;
    }

    this.state.browserAuditSubmitting = true;

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
        })
      });
      const payload = (await response.json()) as BrowserAuditResource & { error?: string };

      if (!response.ok) {
        this.state.browserAuditSubmitError = payload.error ?? 'Failed to start a browser audit.';
        return;
      }

      this.state.selectedBrowserAuditId = payload.id;
      this.state.browserAuditStatusMessage =
        payload.status === 'succeeded'
          ? 'Browser audit completed and was saved to the recent history.'
          : 'Browser audit was saved with a failed result so you can inspect the artifact metadata.';
      await this.accessors.refreshControlData();
    } catch (error) {
      this.state.browserAuditSubmitError =
        error instanceof Error ? error.message : 'Failed to start a browser audit.';
    } finally {
      this.state.browserAuditSubmitting = false;
    }
  };
}

export const createReportsController = (accessors: ReportsAccessors) =>
  new ReportsController(accessors);
