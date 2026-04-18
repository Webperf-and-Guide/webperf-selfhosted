<script lang="ts">
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
  import { Select } from '@webperf/ui/components/ui/select';
  import { Switch } from '@webperf/ui/components/ui/switch';
  import { Textarea } from '@webperf/ui/components/ui/textarea';
  import type { CheckProfile, Property, RegionPack, RouteSet } from '@webperf/contracts';

  type ChecksState = {
    editingProfileId: string;
    profilePropertyId: string;
    profileRouteSetId: string;
    profileRegionPackId: string;
    profileName: string;
    profileNote: string;
    profileScheduleMinutes: string;
    profileRequestMethod: string;
    profileRequestHeadersText: string;
    profileRequestBody: string;
    profileRequestContentType: string;
    profileMonitorType: 'latency' | 'uptime';
    profileLatencyThresholdMs: string;
    profileAlertEnabled: boolean;
    profileAlertOnFailure: boolean;
    profileAlertOnThreshold: boolean;
    profileAlertOnRegression: boolean;
    profileWebhookTargetsText: string;
  };

  let {
    checkProfiles,
    properties,
    routeSets,
    regionPacks,
    state,
    busy,
    onLoadProfileEditor,
    onSubmit,
    onReset,
    onDelete
  } = $props<{
    checkProfiles: CheckProfile[];
    properties: Property[];
    routeSets: RouteSet[];
    regionPacks: RegionPack[];
    state: ChecksState;
    busy: boolean;
    onLoadProfileEditor: (profileId: string) => void;
    onSubmit: (event: SubmitEvent) => void | Promise<void>;
    onReset: () => void;
    onDelete: (profileId: string) => void;
  }>();
</script>

<div class="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.9fr)]">
  <form onsubmit={onSubmit}>
    <ResourceEditorPanel
      description="Define one reusable release decision and keep its request, threshold, and alert policy stable."
      title={state.editingProfileId ? 'Edit saved check' : 'Create saved check'}
    >
      <FieldSet class="mb-4">
        <FieldSetTitle class="text-base">Definition</FieldSetTitle>
        <FieldSetContent class="grid gap-4 md:grid-cols-2">
          <label class="field md:col-span-2">
            <span>Existing saved check</span>
            <Select
              bind:value={state.editingProfileId}
              onchange={(event: Event) => onLoadProfileEditor((event.currentTarget as HTMLSelectElement).value)}
            >
              <option value="">Create new saved check</option>
              {#each checkProfiles as profile (profile.id)}
                <option value={profile.id}>{profile.name}</option>
              {/each}
            </Select>
          </label>
          <label class="field">
            <span>Site</span>
            <Select bind:value={state.profilePropertyId}>
              <option value="">Select site</option>
              {#each properties as property (property.id)}
                <option value={property.id}>{property.name}</option>
              {/each}
            </Select>
          </label>
          <label class="field">
            <span>Route group</span>
            <Select bind:value={state.profileRouteSetId}>
              <option value="">Select route group</option>
              {#each routeSets as routeSet (routeSet.id)}
                <option value={routeSet.id}>{routeSet.name}</option>
              {/each}
            </Select>
          </label>
          <label class="field">
            <span>Region set</span>
            <Select bind:value={state.profileRegionPackId}>
              <option value="">Select region set</option>
              {#each regionPacks as regionPack (regionPack.id)}
                <option value={regionPack.id}>{regionPack.name}</option>
              {/each}
            </Select>
          </label>
          <label class="field">
            <span>Name</span>
            <Input bind:value={state.profileName} placeholder="Release gate" />
          </label>
          <label class="field">
            <span>Note</span>
            <Input bind:value={state.profileNote} placeholder="critical pages" />
          </label>
        </FieldSetContent>
      </FieldSet>

      <FieldSet class="mb-4">
        <FieldSetTitle class="text-base">Request and policy</FieldSetTitle>
        <FieldSetContent class="grid gap-4 md:grid-cols-2">
          <label class="field">
            <span>Request method</span>
            <Select bind:value={state.profileRequestMethod}>
              <option value="GET">GET</option>
              <option value="HEAD">HEAD</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
              <option value="OPTIONS">OPTIONS</option>
            </Select>
          </label>
          <label class="field md:col-span-2">
            <span>Request headers</span>
            <Textarea
              bind:value={state.profileRequestHeadersText}
              rows={3}
              placeholder="Authorization: Bearer sample-token&#10;X-Env: staging"
            />
          </label>
          <label class="field md:col-span-2">
            <span>Request body</span>
            <Textarea
              bind:value={state.profileRequestBody}
              rows={3}
              placeholder="&#123;&quot;release&quot;:&quot;2026.04.12&quot;&#125;"
            />
          </label>
          <label class="field">
            <span>Body content type</span>
            <Input bind:value={state.profileRequestContentType} placeholder="application/json" />
          </label>
          <label class="field">
            <span>Monitor type</span>
            <Select bind:value={state.profileMonitorType}>
              <option value="latency">latency</option>
              <option value="uptime">uptime</option>
            </Select>
          </label>
          <label class="field">
            <span>Latency threshold ms</span>
            <Input bind:value={state.profileLatencyThresholdMs} inputmode="numeric" placeholder="400" />
          </label>
          <label class="field">
            <span>Schedule minutes</span>
            <Input bind:value={state.profileScheduleMinutes} inputmode="numeric" placeholder="5" />
          </label>
        </FieldSetContent>
      </FieldSet>

      <FieldSet>
        <FieldSetTitle class="text-base">Alerts</FieldSetTitle>
        <FieldSetContent class="grid gap-4 md:grid-cols-2">
          <label class="checkbox-field justify-between rounded-[var(--wp-radius-md)] border border-line px-4 py-3 md:col-span-2">
            <span>Enable webhook alerts</span>
            <Switch bind:checked={state.profileAlertEnabled} />
          </label>
          <div class="field">
            <span>Alert triggers</span>
            <div class="checkbox-list">
              <label class="checkbox-field">
                <Checkbox bind:checked={state.profileAlertOnFailure} />
                <span>Failed checks</span>
              </label>
              <label class="checkbox-field">
                <Checkbox bind:checked={state.profileAlertOnThreshold} />
                <span>Threshold breach</span>
              </label>
              <label class="checkbox-field">
                <Checkbox bind:checked={state.profileAlertOnRegression} />
                <span>Baseline regression</span>
              </label>
            </div>
          </div>
          <label class="field md:col-span-2">
            <span>Webhook targets</span>
            <Textarea
              bind:value={state.profileWebhookTargetsText}
              rows={3}
              placeholder="Primary | https://example.com/hooks/webperf | optional-secret"
            />
          </label>
        </FieldSetContent>
        <FieldSetFooter class="builder-actions">
          <Button type="submit" variant="secondary" disabled={busy}>
            {#if busy}{state.editingProfileId ? 'Updating...' : 'Saving...'}{:else}{state.editingProfileId ? 'Update saved check' : 'Save saved check'}{/if}
          </Button>
          {#if state.editingProfileId}
            <Button variant="ghost" type="button" onclick={onReset} disabled={busy}>Cancel</Button>
            <Button variant="destructive" type="button" onclick={() => onDelete(state.editingProfileId)} disabled={busy}>Delete</Button>
          {/if}
        </FieldSetFooter>
      </FieldSet>
    </ResourceEditorPanel>
  </form>

  <article class="builder-card builder-guide">
    <h3>Saved check loop</h3>
    <p class="card-copy">
      Build one check around a real release decision, then keep the review loop consistent:
      run it, pin a trustworthy baseline, compare the next run, and export the resulting evidence.
    </p>

    <div class="guide-grid">
      <div>
        <span>Definition</span>
        <strong>site + route group + region set</strong>
      </div>
      <div>
        <span>Execution</span>
        <strong>manual run or scheduler interval</strong>
      </div>
      <div>
        <span>Decision</span>
        <strong>threshold, regression, webhook alerts</strong>
      </div>
      <div>
        <span>Evidence</span>
        <strong>report export, comparisons, recent runs</strong>
      </div>
    </div>
  </article>
</div>
