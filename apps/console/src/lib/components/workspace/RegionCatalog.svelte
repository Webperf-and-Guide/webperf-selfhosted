<script lang="ts">
  import type { Snippet } from 'svelte';

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
  <div class="section-heading">
    <p class="eyebrow">Region catalog</p>
    <h2>Keep the rollout corridor visible without making it the center of the page.</h2>
    <p class="hint">{selectableCount} of {regionCount} modeled regions are currently activated for measurement.</p>
  </div>

  {@render children?.()}
</section>
