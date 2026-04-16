<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ResourceCountStrip } from '@webperf/ui/components/operator/resource-count-strip';

  let {
    savedChecksEnabled,
    children
  } = $props<{
    savedChecksEnabled: boolean;
    children?: Snippet;
  }>();

  const summaryItems = [
    {
      id: 'comparisons',
      label: 'Comparisons',
      value: 'Latest vs previous and baseline',
      detail: 'Keep regressions, improvements, and unchanged routes isolated from configuration.'
    },
    {
      id: 'exports',
      label: 'Exports',
      value: 'JSON and CSV',
      detail: 'Send deterministic report payloads to CI artifacts, handoffs, or incident notes.'
    },
    {
      id: 'browser',
      label: 'Derived resources',
      value: 'Report browser',
      detail: 'Browse persisted comparisons and exports without leaving the operator workspace.'
    }
  ];
</script>

<section class="reports-section" id="reports">
  <div class="section-heading">
    <p class="eyebrow">Reports and comparisons</p>
    <h2>Browse derived views separately from the setup workflow.</h2>
  </div>

  {#if savedChecksEnabled}
    <ResourceCountStrip items={summaryItems} />

    {@render children?.()}
  {:else}
    <div class="empty-state">
      <p>Derived reports are not available on this control endpoint.</p>
      <small>Use the full self-host API service to persist comparisons, analyses, and exports.</small>
    </div>
  {/if}
</section>
