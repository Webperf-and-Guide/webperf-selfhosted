<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    controlModeLabel,
    controlModeDetail,
    selectableCount,
    regionCount,
    activeRegionPreview,
    savedChecksEnabled,
    checkProfileCount,
    children
  } = $props<{
    controlModeLabel: string;
    controlModeDetail: string;
    selectableCount: number;
    regionCount: number;
    activeRegionPreview: string;
    savedChecksEnabled: boolean;
    checkProfileCount: number;
    children?: Snippet;
  }>();
</script>

<section class="hero" id="measure">
  <div class="hero-copy">
    <p class="eyebrow">Self-host operator console</p>
    <h1>Run a check now, then turn it into a reusable release gate.</h1>
    <p class="lede">
      This is the working surface for one self-hosted WebPerf deployment: launch a manual
      verification, inspect the live control-plane stream, then save repeatable checks with route
      groups, region sets, baselines, schedules, and exports.
    </p>

    <div class="hero-metrics">
      <div>
        <span>Control plane</span>
        <strong>{controlModeLabel}</strong>
        <small>{controlModeDetail}</small>
      </div>
      <div>
        <span>Active regions</span>
        <strong>{selectableCount} active / {regionCount} modeled</strong>
        <small>{activeRegionPreview}</small>
      </div>
      <div>
        <span>Saved checks</span>
        <strong>{savedChecksEnabled ? `${checkProfileCount} reusable checks` : 'Manual runs only'}</strong>
        <small>
          {savedChecksEnabled
            ? 'Promote stable runs into schedules, baselines, and exports.'
            : 'Connect the full self-host API service to unlock persistent resources.'}
        </small>
      </div>
    </div>
  </div>

  {@render children?.()}
</section>
