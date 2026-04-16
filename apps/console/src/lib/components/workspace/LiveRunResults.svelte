<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children } = $props<{ children?: Snippet }>();
</script>

<section class="results-section" id="results">
  <div class="section-heading">
    <p class="eyebrow">Live run state</p>
    <h2>Watch the current verification stream back from the control plane.</h2>
  </div>

  {@render children?.()}
</section>
