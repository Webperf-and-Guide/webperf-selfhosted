<script lang="ts">
  import type { Snippet } from 'svelte';
  import { MetricGrid } from '@webperf/ui/components/operator/metric-grid';

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

  const heroMetrics = $derived.by(() => [
    {
      id: 'control-plane',
      label: 'Control plane',
      value: controlModeLabel,
      detail: controlModeDetail
    },
    {
      id: 'active-regions',
      label: 'Active regions',
      value: `${selectableCount} active / ${regionCount} modeled`,
      detail: activeRegionPreview
    },
    {
      id: 'saved-checks',
      label: 'Saved checks',
      value: savedChecksEnabled ? `${checkProfileCount} reusable checks` : 'Manual runs only',
      detail: savedChecksEnabled
        ? 'Promote stable runs into schedules, baselines, and exports.'
        : 'Connect the full self-host API service to unlock persistent resources.'
    }
  ]);
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
    <MetricGrid columns={3} items={heroMetrics} />
  </div>

  {@render children?.()}
</section>
