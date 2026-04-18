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

<section class="checks-section" id="checks">
  <OperatorSectionHeader
    description="Keep the editor focused on one release decision, then browse compact cards and open deeper evidence only when you need it."
    eyebrow="Reusable checks"
    title="Promote stable manual runs into baseline-aware release gates with schedules and alerts."
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
      detail="Connect the full self-host API service to unlock schedules, baselines, alerts, and exports."
      title="Saved checks are not available on this control endpoint."
    />
  {/if}
</section>
