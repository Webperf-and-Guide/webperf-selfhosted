<script lang="ts">
  import Button from '@webperf/ui/components/ui/button';
  import { CopyButton } from '@webperf/ui/components/ui/copy-button';
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
</script>

<article class="saved-card">
  <div class="saved-head">
    <div>
      <strong>{profile.name}</strong>
      <p class="saved-meta">{propertyName} · {routeSetName} · {regionPackName}</p>
    </div>

    <div class="saved-actions">
      <Button variant="ghost" type="button" onclick={() => onEdit(profile.id)}>Edit</Button>
      <Button variant="destructive" type="button" onclick={() => onDelete(profile.id)} disabled={configBusy}>
        Delete
      </Button>
      <Button variant="secondary" disabled={running} onclick={() => onRun(profile.id)}>
        {#if running}Running...{:else}Run check{/if}
      </Button>
    </div>
  </div>

  {#if profile.note}
    <p class="saved-note">{profile.note}</p>
  {/if}

  <div class="saved-stats">
    <div>
      <span>Schedule</span>
      <strong>{formatSchedule(profile.schedule?.intervalMinutes)}</strong>
    </div>
    <div>
      <span>Request</span>
      <strong>{formatRequestConfig(profile.request)}</strong>
    </div>
    <div>
      <span>Monitor</span>
      <strong>{formatMonitorSummary(profile)}</strong>
    </div>
    <div>
      <span>Alerts</span>
      <strong>{formatAlertSummary(profile)}</strong>
    </div>
    <div>
      <span>Next run</span>
      <strong>{formatDateTime(profile.schedule?.nextRunAt)}</strong>
    </div>
    <div>
      <span>Last run</span>
      <strong>{formatDateTime(profile.schedule?.lastRunAt)}</strong>
    </div>
    <div>
      <span>Recorded runs</span>
      <strong>{recentRunDetails.length}</strong>
    </div>
    <div>
      <span>Baseline</span>
      <strong>{profile.baseline ? formatDateTime(profile.baseline.pinnedAt) : 'not pinned'}</strong>
    </div>
  </div>

  {#if report}
    <div class="comparison-block">
      <div class="comparison-heading">
        <div>
          <strong>Latest run report</strong>
          <small>Compact health verdict plus export actions for this profile.</small>
        </div>
        <div class="saved-actions">
          <Button variant="ghost" type="button" onclick={() => onDownloadReport(profile.id, 'json')}>
            Export JSON
          </Button>
          <Button variant="ghost" type="button" onclick={() => onDownloadReport(profile.id, 'csv')}>
            Export CSV
          </Button>
          <CopyButton text={profile.id}>Copy profile id</CopyButton>
        </div>
      </div>

      <div class="comparison-summary">
        <div>
          <span>Status</span>
          <strong>{report.latestRunSummary?.status ?? 'n/a'}</strong>
        </div>
        <div>
          <span>Monitor</span>
          <strong>{report.latestRunSummary?.evaluation?.monitorType ?? 'n/a'}</strong>
        </div>
        <div>
          <span>Failed checks</span>
          <strong>{report.latestRunSummary?.evaluation?.failedChecks ?? 0}</strong>
        </div>
        <div>
          <span>Threshold breach</span>
          <strong>{report.latestRunSummary?.evaluation?.thresholdBreached ? 'yes' : 'no'}</strong>
        </div>
        <div>
          <span>Regression</span>
          <strong>{report.latestRunSummary?.evaluation?.regressionDetected ? 'yes' : 'no'}</strong>
        </div>
        <div>
          <span>Alerts sent</span>
          <strong>{report.latestRunSummary?.alertDeliveries.length ?? 0}</strong>
        </div>
      </div>
    </div>
  {/if}

  {#if comparisonSections.length > 0}
    <div class="comparison-section-list">
      {#each comparisonSections as section (section.id)}
        <section class="comparison-block">
          <div class="comparison-heading">
            <div>
              <strong>{section.title}</strong>
              <small>{section.subtitle}</small>
            </div>
            <span class="comparison-mode">{section.comparison.mode}</span>
          </div>

          <div class="comparison-summary">
            <div>
              <span>Improved</span>
              <strong>{section.comparison.summary.improved}</strong>
            </div>
            <div>
              <span>Regressed</span>
              <strong>{section.comparison.summary.regressed}</strong>
            </div>
            <div>
              <span>Unchanged</span>
              <strong>{section.comparison.summary.unchanged}</strong>
            </div>
            <div>
              <span>Regions compared</span>
              <strong>{section.comparison.summary.regionsCompared}</strong>
            </div>
          </div>

          <div class="comparison-routes">
            {#each section.comparison.routes as route (route.routeId)}
              <div class="comparison-route">
                <div>
                  <strong>{route.routeLabel}</strong>
                  <small>{route.url}</small>
                </div>

                <div class="comparison-region-grid">
                  {#each route.regions as region (region.region)}
                    <div
                      class="comparison-region-card"
                      class:regressed={region.classification === 'regressed'}
                      class:improved={region.classification === 'improved'}
                    >
                      <div class="comparison-region-head">
                        <strong>{region.region}</strong>
                        <span>{region.classification}</span>
                      </div>
                      <div class="comparison-region-stats">
                        <div>
                          <span>Current</span>
                          <strong>{formatTiming(region.currentLatencyMs)} / {region.currentStatusCode ?? 'n/a'}</strong>
                        </div>
                        <div>
                          <span>Compared</span>
                          <strong>{formatTiming(region.previousLatencyMs)} / {region.previousStatusCode ?? 'n/a'}</strong>
                        </div>
                        <div>
                          <span>Delta</span>
                          <strong>
                            {#if region.latencyDeltaMs != null}
                              {region.latencyDeltaMs > 0 ? '+' : ''}{region.latencyDeltaMs} ms
                            {:else}
                              n/a
                            {/if}
                          </strong>
                        </div>
                        <div>
                          <span>Final URLs</span>
                          <strong>{formatText(region.currentFinalUrl)} -> {formatText(region.previousFinalUrl)}</strong>
                        </div>
                        <div>
                          <span>Impl</span>
                          <strong>{formatText(region.currentProbeImpl)} -> {formatText(region.previousProbeImpl)}</strong>
                        </div>
                        <div>
                          <span>Errors</span>
                          <strong>{formatText(region.currentErrorMessage)} -> {formatText(region.previousErrorMessage)}</strong>
                        </div>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {:else}
    <p class="hint">Run this profile at least twice to unlock latest-vs-previous comparison.</p>
  {/if}

  {#if recentRunDetails.length > 0}
    <div class="run-detail-list">
      {#each recentRunDetails as runDetail (runDetail.run.id)}
        <div class="run-detail-card">
          <div class="run-detail-head">
            <div>
              <strong>{runDetail.run.trigger}</strong>
              <small>{formatDateTime(runDetail.run.createdAt)}</small>
            </div>
            <div class="saved-actions">
              {#if isBaselineRun(profile, runDetail.run.id)}
                <Button variant="ghost" type="button" onclick={() => onClearBaseline(profile.id)} disabled={baselineBusy}>
                  {#if baselineBusy}Clearing...{:else}Clear baseline{/if}
                </Button>
              {:else}
                <Button variant="ghost" type="button" onclick={() => onPinBaseline(profile.id, runDetail.run.id)} disabled={baselineBusy}>
                  {#if baselineBusy}Pinning...{:else}Pin baseline{/if}
                </Button>
              {/if}
            </div>
          </div>

          <div class="recent-runs">
            <div>
              <span>Run id</span>
              <strong class="inline-flex items-center gap-2">
                {runDetail.run.id}
                <CopyButton text={runDetail.run.id}>Copy</CopyButton>
              </strong>
            </div>
            <div>
              <span>Routes</span>
              <strong>{runDetail.run.routeCount}</strong>
            </div>
            <div>
              <span>Jobs</span>
              <strong>{runDetail.jobs.length}</strong>
            </div>
            <div>
              <span>Baseline</span>
              <strong>{isBaselineRun(profile, runDetail.run.id) ? 'pinned' : 'candidate'}</strong>
            </div>
            <div>
              <span>Monitor</span>
              <strong>{runDetail.run.evaluation?.status ?? 'pending'}</strong>
            </div>
            <div>
              <span>Alerts</span>
              <strong>{runDetail.run.alertDeliveries.length}</strong>
            </div>
          </div>

          <div class="run-route-grid">
            {#each runDetail.jobs as runJob (runJob.id)}
              <div class="run-route-card">
                <div>
                  <strong>{runJob.note ?? runJob.url}</strong>
                  <small>{runJob.url}</small>
                </div>
                <div class="run-target-grid">
                  {#each runJob.targets as target (target.region)}
                    <div>
                      <span>{target.region}</span>
                      <strong>{target.status} · {formatTiming(target.latencyMs)}</strong>
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</article>
