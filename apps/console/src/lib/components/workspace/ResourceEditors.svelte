<script lang="ts">
  import { ResourceInventoryStrip } from '@webperf/ui/components/operator/resource-inventory-strip';
  import { ResourceWorkflowStrip } from '@webperf/ui/components/operator/resource-workflow-strip';
  import type { Snippet } from 'svelte';

  let {
    savedChecksEnabled,
    propertyCount,
    routeSetCount,
    regionPackCount,
    children
  } = $props<{
    savedChecksEnabled: boolean;
    propertyCount: number;
    routeSetCount: number;
    regionPackCount: number;
    children?: Snippet;
  }>();

  const workflowItems = [
    {
      id: 'site',
      label: '1. Site',
      title: 'Define the deployment root',
      detail: 'Store the base URL once so route groups and checks can reference it.'
    },
    {
      id: 'route-group',
      label: '2. Route group',
      title: 'Bundle the release-critical URLs',
      detail: 'Keep homepage, pricing, auth, or SEO-sensitive routes together.'
    },
    {
      id: 'region-set',
      label: '3. Region set',
      title: 'Choose the active corridor',
      detail: 'Pin the launch regions you want each reusable check to cover.'
    }
  ];

  const inventoryItems = $derived.by(() => [
    {
      id: 'sites',
      label: 'Sites',
      value: propertyCount,
      detail: 'Deployment roots stored for reuse.'
    },
    {
      id: 'route-groups',
      label: 'Route groups',
      value: routeSetCount,
      detail: 'Reusable URL bundles for release-critical flows.'
    },
    {
      id: 'region-sets',
      label: 'Region sets',
      value: regionPackCount,
      detail: 'Active corridors ready to be assigned to checks.'
    }
  ]);
</script>

<section class="resources-section" id="resources">
  <div class="section-heading">
    <p class="eyebrow">Setup resources</p>
    <h2>Define the shared inputs once so every saved check uses the same operator vocabulary.</h2>
  </div>

  {#if savedChecksEnabled}
    <ResourceWorkflowStrip items={workflowItems} />

    {@render children?.()}

    <ResourceInventoryStrip items={inventoryItems} />
  {:else}
    <div class="empty-state">
      <p>This control endpoint is running in live-check mode only.</p>
      <small>Persistent sites, route groups, and region sets require the full self-host API service.</small>
    </div>
  {/if}
</section>
