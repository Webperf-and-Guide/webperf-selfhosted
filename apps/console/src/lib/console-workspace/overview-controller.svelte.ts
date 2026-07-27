import type { LatencyJobDetail, RuntimeLocationReport } from '@webperf/contracts';
import type { MetricGridItem } from '@webperf/ui/components/operator/types';
import {
  buildRequestConfig,
  formatRequestConfig,
  formatText,
  formatTiming
} from './formatters';

type OverviewAccessors = {
  getRuntimeLocation: () => RuntimeLocationReport;
  getSavedChecksEnabled: () => boolean;
  getCheckProfileCount: () => number;
};

type CreateJobPayload = {
  error?: string;
  job?: LatencyJobDetail;
};

export class OverviewController {
  state = $state({
    targetUrl: '',
    note: '',
    requestMethod: 'GET',
    requestHeadersText: '',
    requestBody: '',
    requestContentType: '',
    jobMonitorType: 'latency' as 'latency' | 'uptime',
    jobLatencyThresholdMs: '',
    isSubmitting: false,
    submitError: null as string | null,
    helperMessage: null as string | null,
    job: null as LatencyJobDetail | null,
    streamState: 'idle' as 'idle' | 'streaming' | 'done'
  });

  private eventSource: EventSource | null = null;

  constructor(private readonly accessors: OverviewAccessors) {}

  // Phase 1 of issue #14: one standalone deployment measures from one fixed
  // runtime location. The previous multi-region selector, quick picks, and
  // active-region preview were removed; the hero metric now reports the
  // deployment's single runtime location.
  get runtimeLocation() {
    return this.accessors.getRuntimeLocation();
  }

  get runtimeLocationLabel() {
    return this.runtimeLocation.label ?? this.runtimeLocation.regionId;
  }

  get controlModeLabel() {
    return this.accessors.getSavedChecksEnabled() ? 'Persistent self-host mode' : 'Live-check mode';
  }

  get controlModeDetail() {
    return this.accessors.getSavedChecksEnabled()
      ? 'Sites, saved checks, diffs, exports, and scheduler dispatch are available.'
      : 'Manual checks are available while saved resources stay offline.';
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
        id: 'runtime-location',
        label: 'Runtime location',
        value: this.runtimeLocationLabel,
        detail: `Measures from this deployment's configured region (${this.runtimeLocation.regionId}).`
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

  submitJob = async (event: SubmitEvent) => {
    event.preventDefault();
    this.state.submitError = null;
    this.state.helperMessage = null;

    if (!this.state.targetUrl) {
      this.state.submitError = 'Enter a URL to measure.';
      return;
    }

    this.state.isSubmitting = true;

    try {
      const response = await fetch('/api/control/jobs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          url: this.state.targetUrl,
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
          }
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
