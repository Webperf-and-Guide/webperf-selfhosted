<script lang="ts">
  import SavedCheckCard from '$lib/components/workspace/SavedCheckCard.svelte';
  import type {
    CheckProfile,
    CheckProfileComparisonResponse,
    CheckProfileLatestComparisonResponse,
    CheckProfileReportResponse,
    CheckProfileRunDetailResponse
  } from '@webperf/contracts';

  type ComparisonSection = {
    id: string;
    title: string;
    subtitle: string;
    comparison: CheckProfileLatestComparisonResponse | CheckProfileComparisonResponse;
  };

  let {
    profiles,
    baselineActionProfileId,
    configBusy,
    formatAlertSummary,
    formatDateTime,
    formatMonitorSummary,
    formatRequestConfig,
    formatSchedule,
    formatText,
    formatTiming,
    getComparisonSections,
    getPropertyName,
    getRecentRunDetails,
    getRegionPackName,
    getReport,
    getRouteSetName,
    isBaselineRun,
    onClearBaseline,
    onDelete,
    onDownloadReport,
    onEdit,
    onPinBaseline,
    onRun,
    runningProfileId
  } = $props<{
    profiles: CheckProfile[];
    baselineActionProfileId: string | null;
    configBusy: boolean;
    formatAlertSummary: (profile: CheckProfile) => string;
    formatDateTime: (value: string | null | undefined) => string;
    formatMonitorSummary: (profile: CheckProfile) => string;
    formatRequestConfig: (request: CheckProfile['request']) => string;
    formatSchedule: (minutes: number | null | undefined) => string;
    formatText: (value: string | null | undefined) => string;
    formatTiming: (value: number | null | undefined) => string;
    getComparisonSections: (profile: CheckProfile) => ComparisonSection[];
    getPropertyName: (profile: CheckProfile) => string;
    getRecentRunDetails: (profileId: string) => CheckProfileRunDetailResponse[];
    getRegionPackName: (profile: CheckProfile) => string;
    getReport: (profileId: string) => CheckProfileReportResponse | null;
    getRouteSetName: (profile: CheckProfile) => string;
    isBaselineRun: (profile: CheckProfile, runId: string) => boolean;
    onClearBaseline: (profileId: string) => void | Promise<void>;
    onDelete: (profileId: string) => void | Promise<void>;
    onDownloadReport: (profileId: string, format: 'json' | 'csv') => void | Promise<void>;
    onEdit: (profileId: string) => void;
    onPinBaseline: (profileId: string, runId: string) => void | Promise<void>;
    onRun: (profileId: string) => void | Promise<void>;
    runningProfileId: string | null;
  }>();
</script>

<div class="saved-grid">
  {#each profiles as profile (profile.id)}
    <SavedCheckCard
      baselineBusy={baselineActionProfileId === profile.id}
      comparisonSections={getComparisonSections(profile)}
      {configBusy}
      {formatAlertSummary}
      {formatDateTime}
      {formatMonitorSummary}
      {formatRequestConfig}
      {formatSchedule}
      {formatText}
      {formatTiming}
      {isBaselineRun}
      onClearBaseline={onClearBaseline}
      onDelete={onDelete}
      onDownloadReport={onDownloadReport}
      onEdit={onEdit}
      onPinBaseline={onPinBaseline}
      onRun={onRun}
      {profile}
      propertyName={getPropertyName(profile)}
      recentRunDetails={getRecentRunDetails(profile.id)}
      regionPackName={getRegionPackName(profile)}
      report={getReport(profile.id)}
      routeSetName={getRouteSetName(profile)}
      running={runningProfileId === profile.id}
    />
  {/each}
</div>
