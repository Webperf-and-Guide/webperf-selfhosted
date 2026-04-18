<script lang="ts">
  import type { Snippet } from 'svelte';
  import { InlineStatusNotice } from '@webperf/ui/components/operator/inline-status-notice';
  import { OperatorEmptyState } from '@webperf/ui/components/operator/operator-empty-state';
  import { OperatorSectionHeader } from '@webperf/ui/components/operator/operator-section-header';
  import { ResourceCountStrip } from '@webperf/ui/components/operator/resource-count-strip';
  import type { MetricGridItem } from '@webperf/ui/components/operator/types';

  let {
    savedChecksEnabled,
    summaryItems,
    statusMessage = null,
    statusError = null,
    children
  } = $props<{
    savedChecksEnabled: boolean;
    summaryItems: MetricGridItem[];
    statusMessage?: string | null;
    statusError?: string | null;
    children?: Snippet;
  }>();
</script>

<section class="reports-section" id="reports">
  <OperatorSectionHeader
    description="Scan comparisons, exports, analyses, and browser audits without leaving the operator workspace."
    eyebrow="Reports and comparisons"
    title="Browse derived views separately from the setup workflow."
  />

  {#if savedChecksEnabled}
    <ResourceCountStrip items={summaryItems} />

    {#if statusError}
      <InlineStatusNotice message={statusError} tone="danger" />
    {/if}

    {#if statusMessage}
      <InlineStatusNotice message={statusMessage} tone="success" />
    {/if}

    {@render children?.()}
  {:else}
    <OperatorEmptyState
      detail="Use the full self-host API service to persist comparisons, analyses, and exports."
      title="Derived reports are not available on this control endpoint."
    />
  {/if}
</section>
