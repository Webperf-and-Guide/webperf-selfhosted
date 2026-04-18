<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { useQueryClient } from '@tanstack/svelte-query';
  import DerivedResourceBrowser from '$lib/components/DerivedResourceBrowser.svelte';
  import BrowserAuditHistory from '$lib/components/workspace/BrowserAuditHistory.svelte';
  import LiveRunResults from '$lib/components/workspace/LiveRunResults.svelte';
  import LiveRunTargetCard from '$lib/components/workspace/LiveRunTargetCard.svelte';
  import ManualRunPanel from '$lib/components/workspace/ManualRunPanel.svelte';
  import RegionCatalog from '$lib/components/workspace/RegionCatalog.svelte';
  import RegionContinentCard from '$lib/components/workspace/RegionContinentCard.svelte';
  import ReportsEndpointsTable from '$lib/components/workspace/ReportsEndpointsTable.svelte';
  import ReportsWorkspace from '$lib/components/workspace/ReportsWorkspace.svelte';
  import ResourceEditors from '$lib/components/workspace/ResourceEditors.svelte';
  import SavedCheckBrowseToolbar from '$lib/components/workspace/SavedCheckBrowseToolbar.svelte';
  import SavedCheckEditor from '$lib/components/workspace/SavedCheckEditor.svelte';
  import SavedCheckEmptyState from '$lib/components/workspace/SavedCheckEmptyState.svelte';
  import SavedCheckList from '$lib/components/workspace/SavedCheckList.svelte';
  import SavedChecksWorkspace from '$lib/components/workspace/SavedChecksWorkspace.svelte';
  import WorkspaceMap from '$lib/components/workspace/WorkspaceMap.svelte';
  import { createChecksController } from '$lib/console-workspace/checks-controller.svelte';
  import { createOverviewController } from '$lib/console-workspace/overview-controller.svelte';
  import { createRegionsController } from '$lib/console-workspace/regions-controller.svelte';
  import { createReportsController } from '$lib/console-workspace/reports-controller.svelte';
  import { createResourcesController } from '$lib/console-workspace/resources-controller.svelte';
  import { MetricGrid } from '@webperf/ui/components/operator/metric-grid';
  import { RegionQuickPick } from '@webperf/ui/components/operator/region-quick-pick';
  import { ResourceEditorPanel } from '@webperf/ui/components/operator/resource-editor-panel';
  import Button from '@webperf/ui/components/ui/button';
  import { Checkbox } from '@webperf/ui/components/ui/checkbox';
  import {
    Root as FieldSet,
    Content as FieldSetContent,
    Footer as FieldSetFooter,
    Title as FieldSetTitle
  } from '@webperf/ui/components/ui/field-set';
  import { Input } from '@webperf/ui/components/ui/input';
  import { ScrollArea } from '@webperf/ui/components/ui/scroll-area';
  import { Select } from '@webperf/ui/components/ui/select';
  import { Switch } from '@webperf/ui/components/ui/switch';
  import { TagsInput } from '@webperf/ui/components/ui/tags-input';
  import { Tabs, TabsContent, TabsList, TabsTrigger } from '@webperf/ui/components/ui/tabs';
  import { Textarea } from '@webperf/ui/components/ui/textarea';
  import type { CheckProfile, RegionAvailability } from '@webperf/contracts';
  import { onDestroy } from 'svelte';
  import type { ConsolePageData, ConsoleWorkspaceMode } from '$lib/console-data';
  import {
    formatDateTime,
    formatPercentScore,
    formatText,
    formatTiming
  } from '$lib/console-workspace/formatters';

  let { data, mode = 'overview' } = $props<{
    data: ConsolePageData;
    mode?: ConsoleWorkspaceMode;
  }>();
  const queryClient = useQueryClient();

  const regions = $derived.by(() => data.regions ?? []);
  const browserAudits = $derived.by(() => data.browserAudits ?? []);
  const savedChecks = $derived.by(() => data.savedChecks ?? null);
  const properties = $derived.by(() => savedChecks?.properties ?? []);
  const routeSets = $derived.by(() => savedChecks?.routeSets ?? []);
  const regionPacks = $derived.by(() => savedChecks?.regionPacks ?? []);
  const checkProfiles = $derived.by(() => savedChecks?.checkProfiles ?? []);
  const profileMetaEntries = $derived.by(() => savedChecks?.profileMeta ?? []);
  const showOverview = $derived(mode === 'overview');
  const showResources = $derived(mode === 'resources');
  const showChecks = $derived(mode === 'checks');
  const showReports = $derived(mode === 'reports');
  const showRegions = $derived(mode === 'regions');

  const refreshControlData = async () => {
    await invalidateAll();
    await queryClient.invalidateQueries({ queryKey: ['control'] });
  };
  const overview = createOverviewController({
    getRegions: () => regions,
    getTurnstileSiteKey: () => data.turnstileSiteKey ?? null,
    getSavedChecksEnabled: () => Boolean(savedChecks),
    getCheckProfileCount: () => checkProfiles.length
  });
  const overviewState = overview.state;
  const resources = createResourcesController({
    getProperties: () => properties,
    getRouteSets: () => routeSets,
    getRegionPacks: () => regionPacks,
    getActiveRegionOptions: () => overview.activeRegionOptions,
    refreshControlData
  });
  const resourcesState = resources.state;
  const checks = createChecksController({
    getSavedChecksEnabled: () => Boolean(savedChecks),
    getProperties: () => properties,
    getRouteSets: () => routeSets,
    getRegionPacks: () => regionPacks,
    getCheckProfiles: () => checkProfiles,
    getProfileMetaEntries: () => profileMetaEntries,
    refreshControlData
  });
  const checksState = checks.state;
  const reports = createReportsController({
    getSavedChecksEnabled: () => Boolean(savedChecks),
    getBrowserAudits: () => browserAudits,
    getBrowserAuditDirectRunEnabled: () => data.capabilities.browserAuditDirectRun,
    getRegions: () => regions,
    refreshControlData
  });
  const reportsState = reports.state;
  const regionCatalog = createRegionsController({
    getRegions: () => regions,
    getSelectedRegions: () => overview.selectedRegions,
    toggleRegion: overview.toggleRegion
  });

  const maxSelectableRegions = overview.maxSelectableRegions;
  const turnstileSiteKey = $derived.by(() => overview.turnstileSiteKey);
  const selectableCount = $derived.by(() => overview.selectableCount);
  const selectedRegions = $derived.by(() => overview.selectedRegions);
  const activeRegionPreview = $derived.by(() => overview.activeRegionPreview);
  const controlModeLabel = $derived.by(() => overview.controlModeLabel);
  const controlModeDetail = $derived.by(() => overview.controlModeDetail);
  const quickRegionItems = $derived.by(() => overview.quickRegionItems);
  const jobSummaryItems = $derived.by(() => overview.jobSummaryItems);
  const activeRegionOptions = $derived.by(() => resources.activeRegionOptions);
  const activeRegionCodeSuggestions = $derived.by(() => resources.activeRegionCodeSuggestions);
  const propertyById = $derived.by(() => resources.propertyById);
  const visibleCheckProfiles = $derived.by(() => checks.visibleCheckProfiles);
  const checkProfilePageInfo = $derived.by(() => checks.checkProfilePageInfo);
  const groupedRegions = $derived.by(() => regionCatalog.groupedRegions);

  onDestroy(() => {
    overview.destroy();
  });
</script>

<svelte:head>
  {#if turnstileSiteKey}
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  {/if}
</svelte:head>

{#if showOverview}
  <ManualRunPanel
    heroMetrics={overview.heroMetrics}
  >
    <form class="control-card" onsubmit={overview.submitJob}>
      <div class="card-intro">
        <p class="eyebrow">Manual run</p>
        <h2>Launch a one-off verification</h2>
        <p class="card-copy">
          Use this for deploy smoke checks and incident verification, then save the setup as a
          reusable check if it belongs in the long-term release workflow.
        </p>
      </div>

      <FieldSet>
        <FieldSetTitle class="text-lg">Run details</FieldSetTitle>
        <FieldSetContent class="grid gap-4">
          <label class="field">
            <span>Site URL</span>
            <Input bind:value={overviewState.targetUrl} name="url" type="url" placeholder="https://example.com" />
          </label>

          <label class="field">
            <span>Run note</span>
            <Input
              bind:value={overviewState.note}
              name="note"
              maxlength={200}
              placeholder="release canary, home page, pricing flow..."
            />
          </label>

            <label class="field">
              <span>Monitor type</span>
            <Select bind:value={overviewState.jobMonitorType}>
              <option value="latency">latency</option>
              <option value="uptime">uptime</option>
            </Select>
          </label>

          <label class="field">
            <span>Latency threshold ms</span>
            <Input bind:value={overviewState.jobLatencyThresholdMs} inputmode="numeric" placeholder="400" />
          </label>

          <div class="field">
            <span>Selected regions</span>
            <strong>{selectedRegions.length} / {maxSelectableRegions}</strong>
          </div>

          <RegionQuickPick
            items={quickRegionItems}
            label="Quick region picks"
            summary={`${selectedRegions.length} / ${maxSelectableRegions}`}
          />
        </FieldSetContent>
      </FieldSet>

      <details class="advanced-panel">
        <summary>Advanced request overrides</summary>

        <FieldSet class="mt-3 border-line/70 bg-white/5">
          <FieldSetTitle class="text-base">Request overrides</FieldSetTitle>
          <FieldSetContent class="advanced-grid">
            <label class="field">
              <span>Request method</span>
              <Select bind:value={overviewState.requestMethod}>
                <option value="GET">GET</option>
                <option value="HEAD">HEAD</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
                <option value="OPTIONS">OPTIONS</option>
              </Select>
            </label>

            <label class="field">
              <span>Custom headers</span>
              <Textarea
                bind:value={overviewState.requestHeadersText}
                rows={3}
                placeholder="Authorization: Bearer sample-token&#10;X-Env: staging"
              />
            </label>

            <label class="field">
              <span>Request body</span>
              <Textarea
                bind:value={overviewState.requestBody}
                rows={3}
                placeholder="&#123;&quot;release&quot;:&quot;2026.04.12&quot;&#125;"
              />
            </label>

            <label class="field">
              <span>Body content type</span>
              <Input bind:value={overviewState.requestContentType} placeholder="application/json" />
            </label>
          </FieldSetContent>
        </FieldSet>
      </details>

    {#if turnstileSiteKey}
      <div class="turnstile-shell">
        <div class="cf-turnstile" data-sitekey={turnstileSiteKey}></div>
      </div>
    {:else}
      <p class="hint">Turnstile is optional in local dev and enforced when the site key is configured.</p>
    {/if}

    {#if overviewState.submitError}
      <p class="error">{overviewState.submitError}</p>
    {/if}

    {#if overviewState.helperMessage}
      <p class="hint">{overviewState.helperMessage}</p>
    {/if}

      <Button class="w-full justify-center" disabled={overviewState.isSubmitting} size="lg" type="submit">
        {#if overviewState.isSubmitting}Opening regional slots...{:else}Start measurement{/if}
      </Button>
    </form>
  </ManualRunPanel>

  <WorkspaceMap />

  <LiveRunResults>
    {#if overviewState.job}
    <MetricGrid class="job-summary" columns={6} items={jobSummaryItems} />

    <div class="result-grid">
      {#each overviewState.job.targets as target (target.region)}
        <LiveRunTargetCard formatText={overview.formatText} formatTiming={overview.formatTiming} {target} />
      {/each}
    </div>
    {:else}
      <div class="empty-state">
        <p>No verification is running yet.</p>
        <small>Start a manual run above and the control-plane stream will appear here immediately.</small>
      </div>
    {/if}
  </LiveRunResults>
{/if}

{#if showResources}
  <ResourceEditors
    inventoryItems={resources.inventoryItems}
    savedChecksEnabled={Boolean(savedChecks)}
    statusError={resourcesState.configActionError}
    statusMessage={resourcesState.configActionMessage}
    workflowItems={resources.workflowItems}
  >
    {#if savedChecks}
      <div class="builder-grid resources-grid">
        <form onsubmit={resources.submitProperty}>
          <ResourceEditorPanel
            description="Store the deployment root once so route groups and saved checks can share it."
            title={resourcesState.editingPropertyId ? 'Edit site' : 'Create site'}
          >
            <label class="field">
              <span>Existing site</span>
              <Select
                bind:value={resourcesState.editingPropertyId}
                onchange={(event: Event) =>
                  resources.loadPropertyEditor((event.currentTarget as HTMLSelectElement).value)}
              >
                <option value="">Create new site</option>
                {#each properties as property (property.id)}
                  <option value={property.id}>{property.name}</option>
                {/each}
              </Select>
            </label>
            <label class="field">
              <span>Name</span>
              <Input bind:value={resourcesState.propertyName} placeholder="Main site" />
            </label>
            <label class="field">
              <span>Base URL</span>
              <Input bind:value={resourcesState.propertyBaseUrl} type="url" placeholder="https://example.com" />
            </label>
            {#snippet footer()}
              <Button type="submit" variant="secondary" disabled={resources.isConfigBusy('property')}>
                {#if resources.isConfigBusy('property')}{resourcesState.editingPropertyId ? 'Updating...' : 'Saving...'}{:else}{resourcesState.editingPropertyId ? 'Update site' : 'Save site'}{/if}
              </Button>
              {#if resourcesState.editingPropertyId}
                <Button variant="ghost" type="button" onclick={resources.resetPropertyForm} disabled={resources.isConfigBusy('property')}>Cancel</Button>
                <Button variant="destructive" type="button" onclick={() => resources.deleteProperty(resourcesState.editingPropertyId)} disabled={resources.isConfigBusy('property')}>Delete</Button>
              {/if}
            {/snippet}
          </ResourceEditorPanel>
        </form>

        <form onsubmit={resources.submitRouteSet}>
          <ResourceEditorPanel
            description="Bundle release-critical URLs so a saved check keeps the same route vocabulary every time."
            title={resourcesState.editingRouteSetId ? 'Edit route group' : 'Create route group'}
          >
            <label class="field">
              <span>Existing route group</span>
              <Select
                bind:value={resourcesState.editingRouteSetId}
                onchange={(event: Event) =>
                  resources.loadRouteSetEditor((event.currentTarget as HTMLSelectElement).value)}
              >
                <option value="">Create new route group</option>
                {#each routeSets as routeSet (routeSet.id)}
                  <option value={routeSet.id}>
                    {routeSet.name} · {propertyById.get(routeSet.propertyId)?.name ?? 'Unknown site'}
                  </option>
                {/each}
              </Select>
            </label>
            <label class="field">
              <span>Site</span>
              <Select bind:value={resourcesState.routeSetPropertyId}>
                <option value="">Select site</option>
                {#each properties as property (property.id)}
                  <option value={property.id}>{property.name}</option>
                {/each}
              </Select>
            </label>
            <label class="field">
              <span>Name</span>
              <Input bind:value={resourcesState.routeSetName} placeholder="Core routes" />
            </label>
            <label class="field">
              <span>Routes</span>
              <Textarea
                bind:value={resourcesState.routeSetRoutesText}
                rows={4}
                placeholder="Homepage | http://example.com&#10;Pricing | http://example.com/pricing"
              />
            </label>
            {#snippet footer()}
              <Button type="submit" variant="secondary" disabled={resources.isConfigBusy('route-set')}>
                {#if resources.isConfigBusy('route-set')}{resourcesState.editingRouteSetId ? 'Updating...' : 'Saving...'}{:else}{resourcesState.editingRouteSetId ? 'Update route group' : 'Save route group'}{/if}
              </Button>
              {#if resourcesState.editingRouteSetId}
                <Button variant="ghost" type="button" onclick={resources.resetRouteSetForm} disabled={resources.isConfigBusy('route-set')}>Cancel</Button>
                <Button variant="destructive" type="button" onclick={() => resources.deleteRouteSet(resourcesState.editingRouteSetId)} disabled={resources.isConfigBusy('route-set')}>Delete</Button>
              {/if}
            {/snippet}
          </ResourceEditorPanel>
        </form>

        <form onsubmit={resources.submitRegionPack}>
          <ResourceEditorPanel
            description="Pin the active corridor that each saved check should cover."
            title={resourcesState.editingRegionPackId ? 'Edit region set' : 'Create region set'}
          >
            <label class="field">
              <span>Existing region set</span>
              <Select
                bind:value={resourcesState.editingRegionPackId}
                onchange={(event: Event) =>
                  resources.loadRegionPackEditor((event.currentTarget as HTMLSelectElement).value)}
              >
                <option value="">Create new region set</option>
                {#each regionPacks as regionPack (regionPack.id)}
                  <option value={regionPack.id}>{regionPack.name}</option>
                {/each}
              </Select>
            </label>
            <label class="field">
              <span>Name</span>
              <Input bind:value={resourcesState.regionPackName} placeholder="APAC core" />
            </label>
            <label class="field">
              <span>Selected region codes</span>
              <TagsInput
                bind:value={resourcesState.regionPackCodes}
                placeholder="Add active region codes"
                restrictToSuggestions
                suggestions={activeRegionCodeSuggestions}
              />
            </label>
            <div class="field">
              <span>Regions</span>
              <div class="pill-grid">
                {#each activeRegionOptions as region (region.code)}
                  <Button
                    class={`pill-button ${resourcesState.regionPackCodes.includes(region.code) ? 'selected' : ''}`}
                    variant="ghost"
                    type="button"
                    onclick={() => resources.toggleRegionPackCode(region.code)}
                  >
                    {region.label}
                  </Button>
                {/each}
              </div>
            </div>
            {#snippet footer()}
              <Button type="submit" variant="secondary" disabled={resources.isConfigBusy('region-pack')}>
                {#if resources.isConfigBusy('region-pack')}{resourcesState.editingRegionPackId ? 'Updating...' : 'Saving...'}{:else}{resourcesState.editingRegionPackId ? 'Update region set' : 'Save region set'}{/if}
              </Button>
              {#if resourcesState.editingRegionPackId}
                <Button variant="ghost" type="button" onclick={resources.resetRegionPackForm} disabled={resources.isConfigBusy('region-pack')}>Cancel</Button>
                <Button variant="destructive" type="button" onclick={() => resources.deleteRegionPack(resourcesState.editingRegionPackId)} disabled={resources.isConfigBusy('region-pack')}>Delete</Button>
              {/if}
            {/snippet}
          </ResourceEditorPanel>
        </form>
      </div>
    {/if}
  </ResourceEditors>
{/if}

{#if showChecks}
  <SavedChecksWorkspace
    savedChecksEnabled={Boolean(savedChecks)}
    summaryItems={checks.globalSummaryItems}
    statusError={checksState.profileActionError}
    statusMessage={checksState.profileActionMessage}
  >
    {#if savedChecks}
      <SavedCheckEditor
        busy={checks.isConfigBusy('check-profile')}
        {checkProfiles}
        {properties}
        {regionPacks}
        {routeSets}
        onDelete={checks.deleteCheckProfile}
        onLoadProfileEditor={checks.loadProfileEditor}
        onReset={checks.resetProfileForm}
        onSubmit={checks.submitCheckProfile}
        state={checksState}
      />

      <SavedCheckBrowseToolbar
        appliedFilter={checkProfilePageInfo.filter}
        browseSummaryItems={checks.browseSummaryItems}
        canGoNext={Boolean(checkProfilePageInfo.nextPageToken)}
        canGoPrevious={checksState.checkProfilePreviousTokens.length > 0}
        bind:filterValue={checksState.checkProfileFilterDraft}
        bind:pageSize={checksState.checkProfilePageSize}
        onApply={checks.applyCheckProfileFilter}
        onClear={checks.clearCheckProfileFilter}
        onNext={checks.goToNextCheckProfilePage}
        onPageSizeChange={checks.resetCheckProfilePaging}
        onPrevious={checks.goToPreviousCheckProfilePage}
        totalCount={checkProfilePageInfo.totalCount}
        visibleCount={visibleCheckProfiles.length}
      />

      {#if visibleCheckProfiles.length > 0}
        <SavedCheckList
          baselineActionProfileId={checksState.baselineActionProfileId}
          configBusy={checks.isConfigBusy('check-profile')}
          formatAlertSummary={checks.formatAlertSummary}
          formatDateTime={checks.formatDateTime}
          formatMonitorSummary={checks.formatMonitorSummary}
          formatRequestConfig={checks.formatRequestConfig}
          formatSchedule={checks.formatSchedule}
          formatText={checks.formatText}
          formatTiming={checks.formatTiming}
          getComparisonSections={checks.comparisonSections}
          getPropertyName={checks.getPropertyName}
          getRecentRunDetails={checks.getRecentRunDetails}
          getRegionPackName={checks.getRegionPackName}
          getReport={checks.getReport}
          getRouteSetName={checks.getRouteSetName}
          isBaselineRun={checks.isBaselineRun}
          onClearBaseline={checks.clearBaseline}
          onDelete={checks.deleteCheckProfile}
          onDownloadReport={checks.downloadReport}
          onEdit={checks.loadProfileEditor}
          onPinBaseline={checks.pinBaseline}
          onRun={checks.runCheckProfile}
          profiles={visibleCheckProfiles}
          runningProfileId={checksState.runningProfileId}
        />
      {:else}
        <SavedCheckEmptyState
          detail={checkProfiles.length > 0
            ? 'Try clearing the current filter or paging back to see more saved checks.'
            : undefined}
          title={checkProfiles.length > 0 ? 'No saved checks match the current browse state.' : undefined}
        />
      {/if}
    {/if}
  </SavedChecksWorkspace>
{/if}

{#if showReports}
  <ReportsWorkspace
    savedChecksEnabled={Boolean(savedChecks)}
    statusError={reportsState.browserAuditSubmitError}
    statusMessage={reportsState.browserAuditStatusMessage}
    summaryItems={reports.summaryItems}
  >
    {#if savedChecks}
      <Tabs bind:value={reportsState.workspaceTab}>
        <TabsList variant="line" class="w-full">
          <TabsTrigger value="browser">Derived resources</TabsTrigger>
          <TabsTrigger value="browserAudits">Browser audits</TabsTrigger>
          <TabsTrigger value="endpoints">API endpoints</TabsTrigger>
        </TabsList>
        <TabsContent value="browser">
          <ScrollArea class="max-h-[72vh] rounded-[var(--wp-radius-lg)] border border-line p-1">
            <DerivedResourceBrowser />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="browserAudits">
          <div class="grid gap-4 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <form class="builder-card" onsubmit={reports.submitBrowserAudit}>
              <FieldSet>
                <FieldSetTitle class="text-base">Direct-run browser audit</FieldSetTitle>
                <FieldSetContent class="grid gap-4">
                  <label class="field">
                    <span>Target URL</span>
                    <Input
                      bind:value={reportsState.browserAuditTargetUrl}
                      placeholder="https://example.com"
                      type="url"
                    />
                  </label>

                  <label class="field">
                    <span>Preset</span>
                    <Select bind:value={reportsState.browserAuditPreset}>
                      <option value="mobile">mobile</option>
                      <option value="desktop">desktop</option>
                    </Select>
                  </label>

                  <label class="field">
                    <span>Region</span>
                    <Select bind:value={reportsState.browserAuditRegion}>
                      <option value="">auto-select</option>
                      {#each reports.browserAuditRegionOptions as option (option.value)}
                        <option value={option.value}>{option.label}</option>
                      {/each}
                    </Select>
                  </label>
                </FieldSetContent>
                <FieldSetFooter class="builder-actions">
                  <Button
                    disabled={reportsState.browserAuditSubmitting || !data.capabilities.browserAuditDirectRun}
                    type="submit"
                    variant="secondary"
                  >
                    {#if reportsState.browserAuditSubmitting}Running audit...{:else}Run browser audit{/if}
                  </Button>
                </FieldSetFooter>
              </FieldSet>
              <p class="card-copy mt-4">
                This self-host surface stays direct-run only: one navigation step, persisted summary,
                and artifact metadata without managed fleet orchestration.
              </p>
              {#if !data.capabilities.browserAuditDirectRun}
                <p class="hint mt-3">
                  Configure `SELFHOST_BROWSER_AUDIT_BASE_URL` and `BROWSER_AUDIT_SHARED_SECRET`
                  to enable direct-run browser audits.
                </p>
              {/if}
            </form>

            <BrowserAuditHistory
              audits={browserAudits}
              formatDateTime={formatDateTime}
              formatPercentScore={formatPercentScore}
              formatText={formatText}
              formatTiming={formatTiming}
              onSelect={reports.selectBrowserAudit}
              selectedAuditId={reportsState.selectedBrowserAuditId}
            />
          </div>
        </TabsContent>
        <TabsContent value="endpoints">
          <ReportsEndpointsTable
            endpoints={[
              {
                resource: 'Comparisons',
                purpose: 'Query persisted comparison payloads for CI and manual incident review.',
                path: '/api/control/comparisons'
              },
              {
                resource: 'Exports',
                purpose: 'Retrieve deterministic JSON or CSV report exports for release evidence.',
                path: '/api/control/exports'
              },
              {
                resource: 'Browser audits',
                purpose: 'Inspect optional direct-run browser audit summaries and artifact metadata.',
                path: '/api/control/browser-audits'
              }
            ]}
          />
        </TabsContent>
      </Tabs>
    {/if}
  </ReportsWorkspace>
{/if}

{#if showRegions}
  <RegionCatalog regionCount={regions.length} selectableCount={selectableCount}>
    <ScrollArea class="max-h-[72vh] rounded-[var(--wp-radius-lg)] border border-line p-1">
      <div class="continents pr-3">
        {#each groupedRegions as group (group.continent)}
          <RegionContinentCard
            continent={group.continent}
            regions={group.regions}
            {selectedRegions}
            toggleRegion={regionCatalog.toggleRegion}
          />
        {/each}
      </div>
    </ScrollArea>
  </RegionCatalog>
{/if}
