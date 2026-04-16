<script lang="ts">
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
</script>

<section class="resources-section" id="resources">
  <div class="section-heading">
    <p class="eyebrow">Setup resources</p>
    <h2>Define the shared inputs once so every saved check uses the same operator vocabulary.</h2>
  </div>

  {#if savedChecksEnabled}
    <div class="saved-summary setup-flow resource-flow">
      <div>
        <span>1. Site</span>
        <strong>Define the deployment root</strong>
        <small>Store the base URL once so route groups and checks can reference it.</small>
      </div>
      <div>
        <span>2. Route group</span>
        <strong>Bundle the release-critical URLs</strong>
        <small>Keep homepage, pricing, auth, or SEO-sensitive routes together.</small>
      </div>
      <div>
        <span>3. Region set</span>
        <strong>Choose the active corridor</strong>
        <small>Pin the launch regions you want each reusable check to cover.</small>
      </div>
    </div>

    {@render children?.()}

    <div class="saved-summary resource-summary">
      <div>
        <span>Sites</span>
        <strong>{propertyCount}</strong>
        <small>Deployment roots stored for reuse.</small>
      </div>
      <div>
        <span>Route groups</span>
        <strong>{routeSetCount}</strong>
        <small>Reusable URL bundles for release-critical flows.</small>
      </div>
      <div>
        <span>Region sets</span>
        <strong>{regionPackCount}</strong>
        <small>Active corridors ready to be assigned to checks.</small>
      </div>
    </div>
  {:else}
    <div class="empty-state">
      <p>This control endpoint is running in live-check mode only.</p>
      <small>Persistent sites, route groups, and region sets require the full self-host API service.</small>
    </div>
  {/if}
</section>
