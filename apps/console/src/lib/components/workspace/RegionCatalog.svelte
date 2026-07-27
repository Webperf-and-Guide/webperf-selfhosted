<script lang="ts">
  import type { Snippet } from 'svelte';
  import { OperatorSectionHeader } from '@webperf/ui/components/operator/operator-section-header';

  let {
    regionId,
    regionLabel,
    children
  } = $props<{
    regionId: string;
    regionLabel: string;
    children?: Snippet;
  }>();
</script>

<section class="regions-section" id="regions">
  <OperatorSectionHeader
    eyebrow="Runtime location"
    title="One deployment measures from one fixed runtime location."
    description={`This standalone deployment reports ${regionLabel} (${regionId}). Configure a different identity with SELFHOST_REGION_ID and SELFHOST_REGION_LABEL.`}
  />

  {@render children?.()}
</section>
