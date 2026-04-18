<script lang="ts">
  import type { Snippet } from 'svelte';
  import { MetricGrid } from '@webperf/ui/components/operator/metric-grid';
  import { OperatorSectionHeader } from '@webperf/ui/components/operator/operator-section-header';
  import type { MetricGridItem } from '@webperf/ui/components/operator/types';

  let {
    heroMetrics,
    children
  } = $props<{
    heroMetrics: MetricGridItem[];
    children?: Snippet;
  }>();
</script>

<section class="hero" id="measure">
  <div class="hero-copy">
    <OperatorSectionHeader
      class="gap-5"
      eyebrow="Self-host operator console"
      title="Run a check now, then turn it into a reusable release gate."
      description="This is the working surface for one self-hosted WebPerf deployment: launch a manual verification, inspect the live control-plane stream, then save repeatable checks with route groups, region sets, baselines, schedules, and exports."
    />
    <MetricGrid columns={3} items={heroMetrics} />
  </div>

  {@render children?.()}
</section>
