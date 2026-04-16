<script lang="ts" module>
  import type { HTMLAttributes } from 'svelte/elements';
  import type { MetricGridItem } from '../types';

  export type ResourceInventoryStripProps = HTMLAttributes<HTMLElement> & {
    items: MetricGridItem[];
  };
</script>

<script lang="ts">
  import { ResourceCountStrip } from '../resource-count-strip';

  let { items = [], ...rest }: ResourceInventoryStripProps = $props();
</script>

<ResourceCountStrip {...rest} {items} />
