<script lang="ts">
  import type { Snippet } from 'svelte';
  import { OperatorEmptyState } from '@webperf/ui/components/operator/operator-empty-state';
  import { OperatorSectionHeader } from '@webperf/ui/components/operator/operator-section-header';
  import { ResourceCountStrip } from '@webperf/ui/components/operator/resource-count-strip';
  import type { MetricGridItem } from '@webperf/ui/components/operator/types';

  let {
    savedChecksEnabled,
    summaryItems,
    children
  } = $props<{
    savedChecksEnabled: boolean;
    summaryItems: MetricGridItem[];
    children?: Snippet;
  }>();
</script>

<section class="reports-section" id="reports">
  <OperatorSectionHeader
    eyebrow="Reports and comparisons"
    title="Browse derived views separately from the setup workflow."
  />

  {#if savedChecksEnabled}
    <ResourceCountStrip items={summaryItems} />

    {@render children?.()}
  {:else}
    <OperatorEmptyState
      detail="Use the full self-host API service to persist comparisons, analyses, and exports."
      title="Derived reports are not available on this control endpoint."
    />
  {/if}
</section>
