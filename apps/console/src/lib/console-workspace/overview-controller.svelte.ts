import type { LatencyJobDetail, RegionAvailability } from '@webperf/contracts';
import type { MetricGridItem, RegionQuickPickItem } from '@webperf/ui/components/operator/types';
import {
  buildRequestConfig,
  formatRequestConfig,
  formatText,
  formatTiming,
  MAX_SELECTABLE_REGIONS
} from './formatters';

type OverviewAccessors = {
  getRegions: () => RegionAvailability[];
  getTurnstileSiteKey: () => string | null;
  getSavedChecksEnabled: () => boolean;
  getCheckProfileCount: () => number;
};

type CreateJobPayload = {
  error?: string;
  job?: LatencyJobDetail;
};

export class OverviewController {
  readonly maxSelectableRegions = MAX_SELECTABLE_REGIONS;

  state = $state({
    targetUrl: '',
    note: '',
    requestMethod: 'GET',
    requestHeadersText: '',
    requestBody: '',
    requestContentType: '',
    jobMonitorType: 'latency' as 'latency' | 'uptime',
    jobLatencyThresholdMs: '',
    userSelectedRegions: null as string[] | null,
    isSubmitting: false,
    submitError: null as string | null,
    helperMessage: null as string | null,
    job: null as LatencyJobDetail | null,
    streamState: 'idle' as 'idle' | 'streaming' | 'done'
  });

  private eventSource: EventSource | null = null;

  constructor(private readonly accessors: OverviewAccessors) {}

  get regions() {
    return this.accessors.getRegions();
  }

  get turnstileSiteKey() {
    return this.accessors.getTurnstileSiteKey();
  }

  get selectableCount() {
    return this.regions.filter((region) => region.selectable).length;
  }

  get defaultSelectedRegions() {
    return this.regions
      .filter((region) => region.defaultSelected)
      .map((region) => region.code);
  }

  get selectedRegions() {
    return this.state.userSelectedRegions ?? this.defaultSelectedRegions;
  }

  get activeRegionOptions() {
    return this.regions.filter((region) => region.selectable);
  }

  get activeRegionPreview() {
    const labels = this.activeRegionOptions.slice(0, 4).map((region) => region.label);
    return labels.length > 0 ? labels.join(' · ') : 'No active regions';
  }

  get controlModeLabel() {
    return this.accessors.getSavedChecksEnabled() ? 'Persistent self-host mode' : 'Live-check mode';
  }

  get controlModeDetail() {
    return this.accessors.getSavedChecksEnabled()
      ? 'Sites, saved checks, diffs, exports, and scheduler dispatch are available.'
      : 'Manual checks are available while saved resources stay offline.';
  }

  get quickRegionItems(): RegionQuickPickItem[] {
    return this.activeRegionOptions.map((region) => ({
      id: region.code,
      label: region.label,
      selected: this.selectedRegions.includes(region.code),
      disabled: !region.selectable,
      onclick: () => this.toggleRegion(region)
    }));
  }

  get heroMetrics(): MetricGridItem[] {
    return [
      {
        id: 'control-plane',
        label: 'Control plane',
        value: this.controlModeLabel,
        detail: this.controlModeDetail
      },
      {
        id: 'active-regions',
        label: 'Active regions',
        value: `${this.selectableCount} active / ${this.regions.length} modeled`,
        detail: this.activeRegionPreview
      },
      {
        id: 'saved-checks',
        label: 'Saved checks',
        value: this.accessors.getSavedChecksEnabled()
          ? `${this.accessors.getCheckProfileCount()} reusable checks`
          : 'Manual runs only',
        detail: this.accessors.getSavedChecksEnabled()
          ? 'Promote stable runs into schedules, baselines, and exports.'
          : 'Connect the full self-host API service to unlock persistent resources.'
      }
    ];
  }

  get jobSummaryItems(): MetricGridItem[] {
    if (!this.state.job) {
      return [];
    }

    return [
      { id: 'job', label: 'Job', value: this.state.job.id },
      { id: 'status', label: 'Status', value: this.state.job.status },
      { id: 'request', label: 'Request', value: formatRequestConfig(this.state.job.request) },
      { id: 'stream', label: 'Stream', value: this.state.streamState },
      {
        id: 'targets',
        label: 'Targets',
        value: `${this.state.job.summary.succeeded} done / ${this.state.job.summary.failed} failed / ${this.state.job.summary.inflight} inflight`
      },
      {
        id: 'monitor',
        label: 'Monitor',
        value: this.state.job.evaluation?.status ?? this.state.job.monitorPolicy?.monitorType ?? 'latency'
      }
    ];
  }

  destroy = () => {
    this.closeStream();
  };

  toggleRegion = (region: RegionAvailability) => {
    if (!region.selectable) {
      this.state.helperMessage = `${region.label} is cataloged, but not activated yet.`;
      return;
    }

    this.state.helperMessage = null;

    if (this.selectedRegions.includes(region.code)) {
      this.state.userSelectedRegions = this.selectedRegions.filter((code) => code !== region.code);
      return;
    }

    if (this.selectedRegions.length >= this.maxSelectableRegions) {
      this.state.helperMessage = `You can measure up to ${this.maxSelectableRegions} regions per run.`;
      return;
    }

    this.state.userSelectedRegions = [...this.selectedRegions, region.code];
  };

  submitJob = async (event: SubmitEvent) => {
    event.preventDefault();
    this.state.submitError = null;
    this.state.helperMessage = null;

    if (!this.state.targetUrl) {
      this.state.submitError = 'Enter a URL to measure.';
      return;
    }

    if (this.selectedRegions.length === 0) {
      this.state.submitError = 'Choose at least one active region.';
      return;
    }

    this.state.isSubmitting = true;

    const form = event.currentTarget as HTMLFormElement;
    const turnstileToken = form.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')?.value;

    try {
      const response = await fetch('/api/control/jobs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          url: this.state.targetUrl,
          regions: this.selectedRegions,
          note: this.state.note || undefined,
          request: buildRequestConfig(
            this.state.requestMethod,
            this.state.requestHeadersText,
            this.state.requestBody,
            this.state.requestContentType
          ),
          monitorPolicy: {
            monitorType: this.state.jobMonitorType,
            successRule: 'status_2xx_3xx',
            latencyThresholdMs:
              this.state.jobMonitorType === 'latency' && this.state.jobLatencyThresholdMs
                ? Number(this.state.jobLatencyThresholdMs)
                : null
          },
          turnstileToken: turnstileToken || undefined
        })
      });

      const payload = (await response.json()) as CreateJobPayload;

      if (!response.ok) {
        this.state.submitError = payload.error ?? 'Failed to create a latency job.';
        return;
      }

      if (!payload.job) {
        this.state.submitError = 'The control plane did not return a job snapshot.';
        return;
      }

      this.state.job = payload.job;
      this.state.streamState = 'streaming';
      this.startStream(payload.job.id);
    } catch (error) {
      this.state.submitError = error instanceof Error ? error.message : 'Failed to create a latency job.';
    } finally {
      this.state.isSubmitting = false;
    }
  };

  private closeStream = () => {
    this.eventSource?.close();
    this.eventSource = null;
  };

  private startStream = (jobId: string) => {
    this.closeStream();
    this.state.streamState = 'streaming';

    const nextSource = new EventSource(`/api/control/jobs/${jobId}/stream`);
    this.eventSource = nextSource;

    nextSource.onmessage = (message) => {
      const payload = JSON.parse(message.data) as { job?: LatencyJobDetail; error?: string };

      if (payload.error) {
        this.state.submitError = payload.error;
        this.state.streamState = 'done';
        this.closeStream();
        return;
      }

      if (!payload.job) {
        return;
      }

      this.state.job = payload.job;

      if (payload.job.summary.inflight === 0) {
        this.state.streamState = 'done';
        this.closeStream();
      }
    };

    nextSource.onerror = () => {
      this.closeStream();

      const currentJobId = this.state.job?.id;

      if (this.state.job && currentJobId && this.state.job.summary.inflight > 0) {
        this.state.helperMessage = 'Stream reconnected while the control plane keeps working.';
        setTimeout(() => this.startStream(currentJobId), 1000);
        return;
      }

      this.state.streamState = 'done';
    };
  };

  get formatText() {
    return formatText;
  }

  get formatTiming() {
    return formatTiming;
  }
}

export const createOverviewController = (accessors: OverviewAccessors) =>
  new OverviewController(accessors);
