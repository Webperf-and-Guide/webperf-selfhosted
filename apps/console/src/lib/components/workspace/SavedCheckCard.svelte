<script lang="ts">
  import {
    SavedCheckSummaryCard,
    type ComparisonSummaryData,
    type MetricGridItem,
    type OperatorActionItem,
    type RunHistoryEntry
  } from '@webperf/ui/components/operator/saved-check-summary-card';
  import type {
    CheckProfile,
    CheckProfileReportResponse,
    CheckProfileRunDetailResponse
  } from '@webperf/contracts';
  import type { ComparisonSection } from '$lib/console-view';

  let {
    profile,
    propertyName,
    routeSetName,
    regionPackName,
    configBusy,
    running,
    baselineBusy,
    report,
    comparisonSections,
    recentRunDetails,
    formatAlertSummary,
    formatDateTime,
    formatMonitorSummary,
    formatRequestConfig,
    formatText,
    formatTiming,
    formatSchedule,
    isBaselineRun,
    onDelete,
    onDownloadReport,
    onEdit,
    onPinBaseline,
    onClearBaseline,
    onRun
  } = $props<{
    profile: CheckProfile;
    propertyName: string;
    routeSetName: string;
    regionPackName: string;
    configBusy: boolean;
    running: boolean;
    baselineBusy: boolean;
    report: CheckProfileReportResponse | null;
    comparisonSections: ComparisonSection[];
    recentRunDetails: CheckProfileRunDetailResponse[];
    formatAlertSummary: (profile: CheckProfile) => string;
    formatDateTime: (value: string | null | undefined) => string;
    formatMonitorSummary: (profile: CheckProfile) => string;
    formatRequestConfig: (request: CheckProfile['request']) => string;
    formatText: (value: string | null | undefined) => string;
    formatTiming: (value: number | null | undefined) => string;
    formatSchedule: (minutes: number | null | undefined) => string;
    isBaselineRun: (profile: CheckProfile, runId: string) => boolean;
    onDelete: (profileId: string) => void;
    onDownloadReport: (profileId: string, format: 'json' | 'csv') => void;
    onEdit: (profileId: string) => void;
    onPinBaseline: (profileId: string, runId: string) => void;
    onClearBaseline: (profileId: string) => void;
    onRun: (profileId: string) => void;
  }>();

  const cardActions = $derived.by<OperatorActionItem[]>(() => [
    {
      id: 'edit',
      label: 'Edit',
      variant: 'ghost',
      onclick: () => onEdit(profile.id)
    },
    {
      id: 'delete',
      label: 'Delete',
      variant: 'destructive',
      disabled: configBusy,
      onclick: () => onDelete(profile.id)
    },
    {
      id: 'run',
      label: running ? 'Running...' : 'Run check',
      variant: 'secondary',
      disabled: running,
      onclick: () => onRun(profile.id)
    }
  ]);

  const summaryItems = $derived.by<MetricGridItem[]>(() => [
    { id: 'schedule', label: 'Schedule', value: formatSchedule(profile.schedule?.intervalMinutes) },
    { id: 'request', label: 'Request', value: formatRequestConfig(profile.request) },
    { id: 'monitor', label: 'Monitor', value: formatMonitorSummary(profile) },
    { id: 'alerts', label: 'Alerts', value: formatAlertSummary(profile) },
    { id: 'next-run', label: 'Next run', value: formatDateTime(profile.schedule?.nextRunAt) },
    { id: 'last-run', label: 'Last run', value: formatDateTime(profile.schedule?.lastRunAt) },
    { id: 'recorded-runs', label: 'Recorded runs', value: recentRunDetails.length },
    {
      id: 'baseline',
      label: 'Baseline',
      value: profile.baseline ? formatDateTime(profile.baseline.pinnedAt) : 'not pinned'
    }
  ]);

  const buildComparisonSummary = (
    title: string,
    subtitle: string,
    summary: ComparisonSummaryData['summary'],
    modeLabel?: string,
    actions?: OperatorActionItem[],
    sections?: ComparisonSummaryData['routes']
  ): ComparisonSummaryData => ({
    id: `${profile.id}:${title}`,
    title,
    subtitle,
    modeLabel,
    summary,
    actions,
    routes: sections
  });

  const reportPanel = $derived.by<ComparisonSummaryData | null>(() => {
    if (!report) {
      return null;
    }

    return buildComparisonSummary(
      'Latest run report',
      'Compact health verdict plus export actions for this profile.',
      [
        { id: 'status', label: 'Status', value: report.latestRunSummary?.status ?? 'n/a' },
        {
          id: 'monitor',
          label: 'Monitor',
          value: report.latestRunSummary?.evaluation?.monitorType ?? 'n/a'
        },
        {
          id: 'failed-checks',
          label: 'Failed checks',
          value: report.latestRunSummary?.evaluation?.failedChecks ?? 0
        },
        {
          id: 'threshold-breach',
          label: 'Threshold breach',
          value: report.latestRunSummary?.evaluation?.thresholdBreached ? 'yes' : 'no',
          tone: report.latestRunSummary?.evaluation?.thresholdBreached ? 'warning' : 'muted'
        },
        {
          id: 'regression',
          label: 'Regression',
          value: report.latestRunSummary?.evaluation?.regressionDetected ? 'yes' : 'no',
          tone: report.latestRunSummary?.evaluation?.regressionDetected ? 'danger' : 'muted'
        },
        {
          id: 'alerts-sent',
          label: 'Alerts sent',
          value: report.latestRunSummary?.alertDeliveries.length ?? 0
        }
      ],
      undefined,
      [
        {
          id: 'json',
          label: 'Export JSON',
          variant: 'ghost',
          onclick: () => onDownloadReport(profile.id, 'json')
        },
        {
          id: 'csv',
          label: 'Export CSV',
          variant: 'ghost',
          onclick: () => onDownloadReport(profile.id, 'csv')
        },
        {
          id: 'copy-profile-id',
          kind: 'copy',
          label: 'Copy profile id',
          text: profile.id,
          variant: 'ghost'
        }
      ]
    );
  });

  const comparisonPanels = $derived.by<ComparisonSummaryData[]>(() =>
    comparisonSections.map((section: ComparisonSection) =>
      buildComparisonSummary(
        section.title,
        section.subtitle,
        [
          { id: 'improved', label: 'Improved', value: section.comparison.summary.improved, tone: 'success' },
          { id: 'regressed', label: 'Regressed', value: section.comparison.summary.regressed, tone: 'danger' },
          { id: 'unchanged', label: 'Unchanged', value: section.comparison.summary.unchanged },
          {
            id: 'regions-compared',
            label: 'Regions compared',
            value: section.comparison.summary.regionsCompared
          }
        ],
        section.comparison.mode,
        [],
        section.comparison.routes.map((route) => ({
          id: route.routeId,
          title: route.routeLabel,
          subtitle: route.url,
          regions: route.regions.map((region) => ({
            id: `${route.routeId}:${region.region}`,
            title: region.region,
            classification: region.classification,
            tone:
              region.classification === 'regressed'
                ? 'danger'
                : region.classification === 'improved'
                  ? 'success'
                  : 'muted',
            stats: [
              {
                id: 'current',
                label: 'Current',
                value: `${formatTiming(region.currentLatencyMs)} / ${region.currentStatusCode ?? 'n/a'}`
              },
              {
                id: 'compared',
                label: 'Compared',
                value: `${formatTiming(region.previousLatencyMs)} / ${region.previousStatusCode ?? 'n/a'}`
              },
              {
                id: 'delta',
                label: 'Delta',
                value:
                  region.latencyDeltaMs != null
                    ? `${region.latencyDeltaMs > 0 ? '+' : ''}${region.latencyDeltaMs} ms`
                    : 'n/a'
              },
              {
                id: 'final-urls',
                label: 'Final URLs',
                value: `${formatText(region.currentFinalUrl)} -> ${formatText(region.previousFinalUrl)}`
              },
              {
                id: 'implementation',
                label: 'Impl',
                value: `${formatText(region.currentProbeImpl)} -> ${formatText(region.previousProbeImpl)}`
              },
              {
                id: 'errors',
                label: 'Errors',
                value: `${formatText(region.currentErrorMessage)} -> ${formatText(region.previousErrorMessage)}`
              }
            ]
          }))
        }))
      )
    )
  );

  const runHistory = $derived.by<RunHistoryEntry[]>(() =>
    recentRunDetails.map((runDetail: CheckProfileRunDetailResponse) => ({
      id: runDetail.run.id,
      title: runDetail.run.trigger,
      subtitle: formatDateTime(runDetail.run.createdAt),
      actions: [
        isBaselineRun(profile, runDetail.run.id)
          ? {
              id: 'clear-baseline',
              label: baselineBusy ? 'Clearing...' : 'Clear baseline',
              variant: 'ghost',
              disabled: baselineBusy,
              onclick: () => onClearBaseline(profile.id)
            }
          : {
              id: 'pin-baseline',
              label: baselineBusy ? 'Pinning...' : 'Pin baseline',
              variant: 'ghost',
              disabled: baselineBusy,
              onclick: () => onPinBaseline(profile.id, runDetail.run.id)
            },
        {
          id: 'copy-run-id',
          kind: 'copy',
          label: 'Copy run id',
          text: runDetail.run.id,
          variant: 'ghost'
        }
      ],
      summary: [
        {
          id: 'run-id',
          label: 'Run id',
          value: runDetail.run.id
        },
        { id: 'routes', label: 'Routes', value: runDetail.run.routeCount },
        { id: 'jobs', label: 'Jobs', value: runDetail.jobs.length },
        {
          id: 'baseline',
          label: 'Baseline',
          value: isBaselineRun(profile, runDetail.run.id) ? 'pinned' : 'candidate'
        },
        {
          id: 'monitor',
          label: 'Monitor',
          value: runDetail.run.evaluation?.status ?? 'pending'
        },
        { id: 'alerts', label: 'Alerts', value: runDetail.run.alertDeliveries.length }
      ],
      jobs: runDetail.jobs.map((runJob) => ({
        id: runJob.id,
        title: runJob.note ?? runJob.url,
        subtitle: runJob.url,
        targets: runJob.targets.map((target) => ({
          id: `${runJob.id}:${target.region}`,
          label: target.region,
          value: `${target.status} · ${formatTiming(target.latencyMs)}`
        }))
      }))
    }))
  );
</script>

<SavedCheckSummaryCard
  actions={cardActions}
  comparisonEmptyMessage="Run this profile at least twice to unlock latest-vs-previous comparison."
  comparisonPanels={comparisonPanels}
  meta={`${propertyName} · ${routeSetName} · ${regionPackName}`}
  note={profile.note ?? undefined}
  reportPanel={reportPanel}
  runHistory={runHistory}
  summary={summaryItems}
  title={profile.name}
/>
