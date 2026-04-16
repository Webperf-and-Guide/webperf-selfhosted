<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ResourceCountStrip } from '@webperf/ui/components/operator/resource-count-strip';

  let {
    savedChecksEnabled,
    checkProfilesCount,
    scheduledCheckCount,
    pinnedBaselineCount,
    totalRecordedRuns,
    children
  } = $props<{
    savedChecksEnabled: boolean;
    checkProfilesCount: number;
    scheduledCheckCount: number;
    pinnedBaselineCount: number;
    totalRecordedRuns: number;
    children?: Snippet;
  }>();

  const summaryItems = $derived.by(() => [
    {
      id: 'saved-checks',
      label: 'Saved checks',
      value: checkProfilesCount,
      detail: 'Reusable gates ready for manual runs or scheduled dispatch.'
    },
    {
      id: 'scheduled',
      label: 'Scheduled',
      value: scheduledCheckCount,
      detail: 'Checks already configured with an interval.'
    },
    {
      id: 'baselines',
      label: 'Baselines pinned',
      value: pinnedBaselineCount,
      detail: 'Checks with a canonical run for regression comparisons.'
    },
    {
      id: 'recorded-runs',
      label: 'Recorded runs',
      value: totalRecordedRuns,
      detail: 'Recent execution history available for drill-down and export.'
    }
  ]);
</script>

<section class="checks-section" id="checks">
  <div class="section-heading">
    <p class="eyebrow">Reusable checks</p>
    <h2>Promote stable manual runs into baseline-aware release gates with schedules and alerts.</h2>
  </div>

  {#if savedChecksEnabled}
    <ResourceCountStrip items={summaryItems} />

    {@render children?.()}
  {:else}
    <div class="empty-state">
      <p>Saved checks are not available on this control endpoint.</p>
      <small>Connect the full self-host API service to unlock schedules, baselines, alerts, and exports.</small>
    </div>
  {/if}
</section>
