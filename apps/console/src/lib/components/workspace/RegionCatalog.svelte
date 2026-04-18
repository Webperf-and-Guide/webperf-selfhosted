<script lang="ts">
  import type { Snippet } from 'svelte';
  import { OperatorSectionHeader } from '@webperf/ui/components/operator/operator-section-header';

  let {
    selectableCount,
    regionCount,
    children
  } = $props<{
    selectableCount: number;
    regionCount: number;
    children?: Snippet;
  }>();
</script>

<section class="regions-section" id="regions">
  <OperatorSectionHeader
    eyebrow="Region catalog"
    title="Keep the rollout corridor visible without making it the center of the page."
    description={`${selectableCount} of ${regionCount} modeled regions are currently activated for measurement.`}
  />

  {@render children?.()}
</section>
