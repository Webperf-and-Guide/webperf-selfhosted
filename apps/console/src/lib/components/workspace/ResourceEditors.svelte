<script lang="ts">
  import { ResourceInventoryStrip } from '@webperf/ui/components/operator/resource-inventory-strip';
  import { InlineStatusNotice } from '@webperf/ui/components/operator/inline-status-notice';
  import { OperatorEmptyState } from '@webperf/ui/components/operator/operator-empty-state';
  import { OperatorSectionHeader } from '@webperf/ui/components/operator/operator-section-header';
  import { ResourceWorkflowStrip } from '@webperf/ui/components/operator/resource-workflow-strip';
  import type { MetricGridItem, ResourceWorkflowItem } from '@webperf/ui/components/operator/types';
  import type { Snippet } from 'svelte';

  let {
    savedChecksEnabled,
    inventoryItems,
    statusMessage = null,
    statusError = null,
    workflowItems,
    children
  } = $props<{
    savedChecksEnabled: boolean;
    inventoryItems: MetricGridItem[];
    statusMessage?: string | null;
    statusError?: string | null;
    workflowItems: ResourceWorkflowItem[];
    children?: Snippet;
  }>();
</script>

<section class="resources-section" id="resources">
  <OperatorSectionHeader
    eyebrow="Setup resources"
    title="Define the shared inputs once so every saved check uses the same operator vocabulary."
  />

  {#if savedChecksEnabled}
    <ResourceWorkflowStrip items={workflowItems} />

    {#if statusError}
      <InlineStatusNotice message={statusError} tone="danger" />
    {/if}

    {#if statusMessage}
      <InlineStatusNotice message={statusMessage} tone="success" />
    {/if}

    {@render children?.()}

    <ResourceInventoryStrip items={inventoryItems} />
  {:else}
    <OperatorEmptyState
      detail="Persistent sites, route groups, and region sets require the full self-host API service."
      title="This control endpoint is running in live-check mode only."
    />
  {/if}
</section>
