import { browser } from '$app/environment';
import { createQuery } from '@tanstack/svelte-query';
import { fetchControlJson } from '$lib/client/control-query';
import type { SavedChecksData } from '$lib/console-data';
import type {
  CheckProfile,
  CheckProfileComparisonResponse,
  CheckProfileLatestComparisonResponse,
  CheckProfileListResponse,
  CheckProfileReportResponse,
  CheckProfileRunDetailResponse,
  CheckProfileRunListResponse,
  LatencyJobDetail,
  Property,
  RegionPack,
  RouteSet
} from '@webperf/contracts';
import type { MetricGridItem } from '@webperf/ui/components/operator/types';
import {
  buildComparisonSections,
  buildRequestConfig,
  CONSOLE_COLLECTION_PAGE_SIZE,
  CONSOLE_RECENT_RUN_COUNT,
  formatAlertSummary,
  formatDateTime,
  formatMonitorSummary,
  formatRequestConfig,
  formatSchedule,
  formatText,
  formatTiming,
  parseWebhookTargets,
  stringifyHeaders,
  stringifyWebhookTargets
} from './formatters';

type SavedProfileMeta = SavedChecksData['profileMeta'][number];

type ChecksAccessors = {
  getSavedChecksEnabled: () => boolean;
  getProperties: () => Property[];
  getRouteSets: () => RouteSet[];
  getRegionPacks: () => RegionPack[];
  getCheckProfiles: () => CheckProfile[];
  getProfileMetaEntries: () => SavedProfileMeta[];
  refreshControlData: () => Promise<void>;
};

export class ChecksController {
  state = $state({
    profilePropertyId: '',
    profileRouteSetId: '',
    profileRegionPackId: '',
    profileName: '',
    profileNote: '',
    profileScheduleMinutes: '',
    profileRequestMethod: 'GET',
    profileRequestHeadersText: '',
    profileRequestBody: '',
    profileRequestContentType: '',
    profileMonitorType: 'latency' as 'latency' | 'uptime',
    profileLatencyThresholdMs: '',
    profileAlertEnabled: false,
    profileAlertOnFailure: true,
    profileAlertOnThreshold: false,
    profileAlertOnRegression: false,
    profileWebhookTargetsText: '',
    editingProfileId: '',
    checkProfileFilterDraft: '',
    checkProfileFilter: '',
    checkProfilePageSize: 6,
    checkProfilePageToken: null as string | null,
    checkProfilePreviousTokens: [] as string[],
    savingProfileKind: null as string | null,
    runningProfileId: null as string | null,
    baselineActionProfileId: null as string | null,
    profileActionMessage: null as string | null,
    profileActionError: null as string | null
  });

  readonly checkProfileListQuery;

  constructor(private readonly accessors: ChecksAccessors) {
    this.checkProfileListQuery = createQuery(() => ({
      queryKey: [
        'control',
        'check-profiles',
        this.state.checkProfileFilter,
        this.state.checkProfilePageSize,
        this.state.checkProfilePageToken
      ],
      enabled:
        browser &&
        this.accessors.getSavedChecksEnabled() &&
        (this.checkProfiles.length > 0 ||
          this.state.checkProfileFilter.length > 0 ||
          this.state.checkProfilePageToken !== null),
      initialData: this.buildInitialCheckProfilePage(),
      queryFn: async () =>
        fetchControlJson<CheckProfileListResponse>('check-profiles', {
          pageSize: this.state.checkProfilePageSize,
          pageToken: this.state.checkProfilePageToken,
          filter: this.state.checkProfileFilter || null
        })
    }));
  }

  get properties() {
    return this.accessors.getProperties();
  }

  get routeSets() {
    return this.accessors.getRouteSets();
  }

  get regionPacks() {
    return this.accessors.getRegionPacks();
  }

  get checkProfiles() {
    return this.accessors.getCheckProfiles();
  }

  get profileMetaEntries() {
    return this.accessors.getProfileMetaEntries();
  }

  get propertyById() {
    return new Map<string, Property>(this.properties.map((property) => [property.id, property] as const));
  }

  get routeSetById() {
    return new Map<string, RouteSet>(this.routeSets.map((routeSet) => [routeSet.id, routeSet] as const));
  }

  get regionPackById() {
    return new Map<string, RegionPack>(this.regionPacks.map((regionPack) => [regionPack.id, regionPack] as const));
  }

  get checkProfileById() {
    return new Map<string, CheckProfile>(this.checkProfiles.map((profile) => [profile.id, profile] as const));
  }

  get profileMetaById() {
    return new Map<string, SavedProfileMeta>(
      this.profileMetaEntries.map((entry) => [entry.profileId, entry] as const)
    );
  }

  get scheduledCheckCount() {
    return this.checkProfiles.filter((profile) => Boolean(profile.schedule?.intervalMinutes)).length;
  }

  get pinnedBaselineCount() {
    return this.checkProfiles.filter((profile) => Boolean(profile.baseline?.runId)).length;
  }

  get totalRecordedRuns() {
    return this.profileMetaEntries.reduce((total, entry) => total + entry.runs.length, 0);
  }

  get visibleCheckProfiles() {
    return this.checkProfileListQuery.data?.checkProfiles ?? [];
  }

  get checkProfilePageInfo() {
    return this.checkProfileListQuery.data?.pageInfo ?? this.emptyCheckProfilePageInfo();
  }

  get summaryItems(): MetricGridItem[] {
    return [
      {
        id: 'saved-checks',
        label: 'Saved checks',
        value: this.checkProfiles.length,
        detail: 'Reusable gates ready for manual runs or scheduled dispatch.'
      },
      {
        id: 'scheduled',
        label: 'Scheduled',
        value: this.scheduledCheckCount,
        detail: 'Checks already configured with an interval.'
      },
      {
        id: 'baselines',
        label: 'Baselines pinned',
        value: this.pinnedBaselineCount,
        detail: 'Checks with a canonical run for regression comparisons.'
      },
      {
        id: 'recorded-runs',
        label: 'Recorded runs',
        value: this.totalRecordedRuns,
        detail: 'Recent execution history available for drill-down and export.'
      }
    ];
  }

  isConfigBusy = (prefix: string) => this.state.savingProfileKind?.startsWith(prefix) ?? false;

  resetCheckProfilePaging = () => {
    this.state.checkProfilePageToken = null;
    this.state.checkProfilePreviousTokens = [];
  };

  applyCheckProfileFilter = () => {
    this.state.checkProfileFilter = this.state.checkProfileFilterDraft.trim();
    this.resetCheckProfilePaging();
  };

  clearCheckProfileFilter = () => {
    this.state.checkProfileFilterDraft = '';
    this.state.checkProfileFilter = '';
    this.resetCheckProfilePaging();
  };

  goToNextCheckProfilePage = () => {
    if (!this.checkProfilePageInfo.nextPageToken) {
      return;
    }

    this.state.checkProfilePreviousTokens = [
      ...this.state.checkProfilePreviousTokens,
      this.state.checkProfilePageToken ?? '0'
    ];
    this.state.checkProfilePageToken = this.checkProfilePageInfo.nextPageToken;
  };

  goToPreviousCheckProfilePage = () => {
    if (this.state.checkProfilePreviousTokens.length === 0) {
      return;
    }

    const nextHistory = [...this.state.checkProfilePreviousTokens];
    const previousToken = nextHistory.pop() ?? '0';
    this.state.checkProfilePreviousTokens = nextHistory;
    this.state.checkProfilePageToken = previousToken === '0' ? null : previousToken;
  };

  resetProfileForm = () => {
    this.state.editingProfileId = '';
    this.state.profilePropertyId = '';
    this.state.profileRouteSetId = '';
    this.state.profileRegionPackId = '';
    this.state.profileName = '';
    this.state.profileNote = '';
    this.state.profileScheduleMinutes = '';
    this.state.profileRequestMethod = 'GET';
    this.state.profileRequestHeadersText = '';
    this.state.profileRequestBody = '';
    this.state.profileRequestContentType = '';
    this.state.profileMonitorType = 'latency';
    this.state.profileLatencyThresholdMs = '';
    this.state.profileAlertEnabled = false;
    this.state.profileAlertOnFailure = true;
    this.state.profileAlertOnThreshold = false;
    this.state.profileAlertOnRegression = false;
    this.state.profileWebhookTargetsText = '';
  };

  loadProfileEditor = (profileId: string) => {
    if (!profileId) {
      this.resetProfileForm();
      return;
    }

    const profile = this.checkProfileById.get(profileId);

    if (!profile) {
      return;
    }

    this.state.editingProfileId = profile.id;
    this.state.profilePropertyId = profile.propertyId;
    this.state.profileRouteSetId = profile.routeSetId;
    this.state.profileRegionPackId = profile.regionPackId;
    this.state.profileName = profile.name;
    this.state.profileNote = profile.note ?? '';
    this.state.profileScheduleMinutes = profile.schedule?.intervalMinutes?.toString() ?? '';
    this.state.profileRequestMethod = profile.request?.method ?? 'GET';
    this.state.profileRequestHeadersText = stringifyHeaders(profile.request?.headers ?? []);
    this.state.profileRequestBody = profile.request?.body?.value ?? '';
    this.state.profileRequestContentType = profile.request?.body?.contentType ?? '';
    this.state.profileMonitorType = profile.monitorPolicy?.monitorType ?? 'latency';
    this.state.profileLatencyThresholdMs = profile.monitorPolicy?.latencyThresholdMs?.toString() ?? '';
    this.state.profileAlertEnabled = profile.alerts?.enabled ?? false;
    this.state.profileAlertOnFailure = profile.alerts?.triggers.onFailure ?? true;
    this.state.profileAlertOnThreshold = profile.alerts?.triggers.onLatencyThresholdBreach ?? false;
    this.state.profileAlertOnRegression = profile.alerts?.triggers.onRegression ?? false;
    this.state.profileWebhookTargetsText = stringifyWebhookTargets(profile.alerts?.webhookTargets ?? []);
  };

  submitCheckProfile = async (event: SubmitEvent) => {
    event.preventDefault();
    await this.submitProfileAction(
      'check-profile',
      this.state.editingProfileId ? 'update' : 'create',
      async () => {
        const response = await fetch(
          this.state.editingProfileId
            ? `/api/control/check-profiles/${this.state.editingProfileId}`
            : '/api/control/check-profiles',
          {
            method: this.state.editingProfileId ? 'PUT' : 'POST',
            headers: {
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              propertyId: this.state.profilePropertyId,
              routeSetId: this.state.profileRouteSetId,
              regionPackId: this.state.profileRegionPackId,
              name: this.state.profileName,
              note: this.state.profileNote || undefined,
              request: buildRequestConfig(
                this.state.profileRequestMethod,
                this.state.profileRequestHeadersText,
                this.state.profileRequestBody,
                this.state.profileRequestContentType
              ),
              monitorPolicy: {
                monitorType: this.state.profileMonitorType,
                successRule: 'status_2xx_3xx',
                latencyThresholdMs:
                  this.state.profileMonitorType === 'latency' && this.state.profileLatencyThresholdMs
                    ? Number(this.state.profileLatencyThresholdMs)
                    : null
              },
              alerts: {
                enabled: this.state.profileAlertEnabled,
                webhookTargets: parseWebhookTargets(this.state.profileWebhookTargetsText),
                triggers: {
                  onFailure: this.state.profileAlertOnFailure,
                  onLatencyThresholdBreach: this.state.profileAlertOnThreshold,
                  onRegression: this.state.profileAlertOnRegression
                }
              },
              scheduleIntervalMinutes: this.state.profileScheduleMinutes
                ? Number(this.state.profileScheduleMinutes)
                : undefined
            })
          }
        );

        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(
            payload.error ?? `Failed to ${this.state.editingProfileId ? 'update' : 'create'} saved check.`
          );
        }

        const actionLabel = this.state.editingProfileId ? 'updated' : 'created';
        this.resetProfileForm();
        return `Check profile ${actionLabel}.`;
      }
    );
  };

  deleteCheckProfile = async (profileId: string) => {
    if (!confirm('Delete this saved check and its recorded run links?')) {
      return;
    }

    await this.submitProfileAction('check-profile', 'delete', async () => {
      const response = await fetch(`/api/control/check-profiles/${profileId}`, {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json'
        }
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Failed to delete saved check.');
      }

      this.resetProfileForm();
      return 'Check profile deleted.';
    });
  };

  runCheckProfile = async (profileId: string) => {
    this.state.runningProfileId = profileId;
    this.state.profileActionError = null;
    this.state.profileActionMessage = null;

    try {
      const response = await fetch(`/api/control/check-profiles/${profileId}/runs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: '{}'
      });

      const payload = (await response.json()) as {
        error?: string;
        jobs?: Array<{ id: string }>;
      };

      if (!response.ok) {
        this.state.profileActionError = payload.error ?? 'Failed to run the saved check.';
        return;
      }

      this.state.profileActionMessage = `Triggered ${payload.jobs?.length ?? 0} route checks for ${profileId}.`;
      await this.accessors.refreshControlData();
    } catch (error) {
      this.state.profileActionError = error instanceof Error ? error.message : 'Failed to run the saved check.';
    } finally {
      this.state.runningProfileId = null;
    }
  };

  pinBaseline = async (profileId: string, runId: string) => {
    this.state.baselineActionProfileId = profileId;
    this.state.profileActionError = null;
    this.state.profileActionMessage = null;

    try {
      const response = await fetch(`/api/control/check-profiles/${profileId}/baseline`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          runId
        })
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        this.state.profileActionError = payload.error ?? 'Failed to pin baseline.';
        return;
      }

      this.state.profileActionMessage = 'Baseline pinned.';
      await this.accessors.refreshControlData();
    } catch (error) {
      this.state.profileActionError = error instanceof Error ? error.message : 'Failed to pin baseline.';
    } finally {
      this.state.baselineActionProfileId = null;
    }
  };

  clearBaseline = async (profileId: string) => {
    this.state.baselineActionProfileId = profileId;
    this.state.profileActionError = null;
    this.state.profileActionMessage = null;

    try {
      const response = await fetch(`/api/control/check-profiles/${profileId}/baseline`, {
        method: 'DELETE'
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        this.state.profileActionError = payload.error ?? 'Failed to clear baseline.';
        return;
      }

      this.state.profileActionMessage = 'Baseline cleared.';
      await this.accessors.refreshControlData();
    } catch (error) {
      this.state.profileActionError = error instanceof Error ? error.message : 'Failed to clear baseline.';
    } finally {
      this.state.baselineActionProfileId = null;
    }
  };

  downloadReport = async (profileId: string, format: 'json' | 'csv') => {
    this.state.profileActionError = null;
    this.state.profileActionMessage = null;

    try {
      const response = await fetch(`/api/control/check-profiles/${profileId}/report/export?format=${format}`);

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? 'Failed to export report.');
      }

      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = `${profileId}-report.${format}`;
      anchor.click();
      window.URL.revokeObjectURL(blobUrl);
      this.state.profileActionMessage = `Downloaded ${format.toUpperCase()} report.`;
    } catch (error) {
      this.state.profileActionError = error instanceof Error ? error.message : 'Failed to export report.';
    }
  };

  getPropertyName = (profile: CheckProfile) =>
    this.propertyById.get(profile.propertyId)?.name ?? 'Unknown site';

  getRouteSetName = (profile: CheckProfile) =>
    this.routeSetById.get(profile.routeSetId)?.name ?? 'Unknown route group';

  getRegionPackName = (profile: CheckProfile) =>
    this.regionPackById.get(profile.regionPackId)?.name ?? 'Unknown region set';

  getProfileMeta = (profileId: string) => this.profileMetaById.get(profileId) ?? null;

  getLatestComparison = (profileId: string): CheckProfileLatestComparisonResponse | null =>
    this.getProfileMeta(profileId)?.latestComparison ?? null;

  getBaselineComparison = (profileId: string): CheckProfileComparisonResponse | null =>
    this.getProfileMeta(profileId)?.baselineComparison ?? null;

  getRecentRunDetails = (profileId: string): CheckProfileRunDetailResponse[] =>
    this.getProfileMeta(profileId)?.recentRunDetails ?? [];

  getReport = (profileId: string): CheckProfileReportResponse | null =>
    this.getProfileMeta(profileId)?.report ?? null;

  getBaselineRunId = (profile: CheckProfile) => profile.baseline?.runId ?? null;

  isBaselineRun = (profile: CheckProfile, runId: string) => this.getBaselineRunId(profile) === runId;

  comparisonSections = (profile: CheckProfile) =>
    buildComparisonSections(this.getLatestComparison(profile.id), this.getBaselineComparison(profile.id));

  get formatAlertSummary() {
    return formatAlertSummary;
  }

  get formatDateTime() {
    return formatDateTime;
  }

  get formatMonitorSummary() {
    return formatMonitorSummary;
  }

  get formatRequestConfig() {
    return formatRequestConfig;
  }

  get formatText() {
    return formatText;
  }

  get formatTiming() {
    return formatTiming;
  }

  get formatSchedule() {
    return formatSchedule;
  }

  private emptyCheckProfilePageInfo = () => ({
    pageSize: this.state.checkProfilePageSize,
    totalCount: this.checkProfiles.length,
    nextPageToken: null,
    filter: null
  });

  private buildInitialCheckProfilePage = (): CheckProfileListResponse => {
    const initialProfiles = this.checkProfiles.slice(0, this.state.checkProfilePageSize);
    return {
      checkProfiles: initialProfiles,
      pageInfo: {
        pageSize: this.state.checkProfilePageSize,
        totalCount: this.checkProfiles.length,
        nextPageToken:
          this.checkProfiles.length > initialProfiles.length ? String(initialProfiles.length) : null,
        filter: null
      }
    };
  };

  private submitProfileAction = async (
    kind: string,
    actionName: 'create' | 'update' | 'delete',
    action: () => Promise<string>
  ) => {
    this.state.savingProfileKind = `${kind}:${actionName}`;
    this.state.profileActionError = null;
    this.state.profileActionMessage = null;

    try {
      const message = await action();
      this.state.profileActionMessage = message;
      await this.accessors.refreshControlData();
    } catch (error) {
      this.state.profileActionError =
        error instanceof Error ? error.message : `Failed to ${actionName} ${kind.replace('-', ' ')}.`;
    } finally {
      this.state.savingProfileKind = null;
    }
  };
}

export const createChecksController = (accessors: ChecksAccessors) =>
  new ChecksController(accessors);
