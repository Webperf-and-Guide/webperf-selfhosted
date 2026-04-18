<script lang="ts">
  import type { Snippet } from 'svelte';
  import { OperatorSectionHeader } from '@webperf/ui/components/operator/operator-section-header';

  let { children } = $props<{ children?: Snippet }>();
</script>

<section class="results-section" id="results">
  <OperatorSectionHeader
    eyebrow="Live run state"
    title="Watch the current verification stream back from the control plane."
  />

  {@render children?.()}
</section>
