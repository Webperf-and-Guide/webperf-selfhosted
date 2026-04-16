<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    savedChecksEnabled,
    children
  } = $props<{
    savedChecksEnabled: boolean;
    children?: Snippet;
  }>();
</script>

<section class="reports-section" id="reports">
  <div class="section-heading">
    <p class="eyebrow">Reports and comparisons</p>
    <h2>Browse derived views separately from the setup workflow.</h2>
  </div>

  {#if savedChecksEnabled}
    <div class="saved-summary report-summary">
      <div>
        <span>Comparisons</span>
        <strong>Latest vs previous and baseline</strong>
        <small>Keep regressions, improvements, and unchanged routes isolated from configuration.</small>
      </div>
      <div>
        <span>Exports</span>
        <strong>JSON and CSV</strong>
        <small>Send deterministic report payloads to CI artifacts, handoffs, or incident notes.</small>
      </div>
      <div>
        <span>Derived resources</span>
        <strong>Report browser</strong>
        <small>Browse persisted comparisons and exports without leaving the operator workspace.</small>
      </div>
    </div>

    {@render children?.()}
  {:else}
    <div class="empty-state">
      <p>Derived reports are not available on this control endpoint.</p>
      <small>Use the full self-host API service to persist comparisons, analyses, and exports.</small>
    </div>
  {/if}
</section>
