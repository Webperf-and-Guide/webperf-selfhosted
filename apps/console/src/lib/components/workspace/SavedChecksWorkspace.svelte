<script lang="ts">
  import type { Snippet } from 'svelte';

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
</script>

<section class="checks-section" id="checks">
  <div class="section-heading">
    <p class="eyebrow">Reusable checks</p>
    <h2>Promote stable manual runs into baseline-aware release gates with schedules and alerts.</h2>
  </div>

  {#if savedChecksEnabled}
    <div class="saved-summary check-stage">
      <div>
        <span>Saved checks</span>
        <strong>{checkProfilesCount}</strong>
        <small>Reusable gates ready for manual runs or scheduled dispatch.</small>
      </div>
      <div>
        <span>Scheduled</span>
        <strong>{scheduledCheckCount}</strong>
        <small>Checks already configured with an interval.</small>
      </div>
      <div>
        <span>Baselines pinned</span>
        <strong>{pinnedBaselineCount}</strong>
        <small>Checks with a canonical run for regression comparisons.</small>
      </div>
      <div>
        <span>Recorded runs</span>
        <strong>{totalRecordedRuns}</strong>
        <small>Recent execution history available for drill-down and export.</small>
      </div>
    </div>

    {@render children?.()}
  {:else}
    <div class="empty-state">
      <p>Saved checks are not available on this control endpoint.</p>
      <small>Connect the full self-host API service to unlock schedules, baselines, alerts, and exports.</small>
    </div>
  {/if}
</section>
