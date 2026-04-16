<script lang="ts" module>
  import type { HTMLAttributes } from 'svelte/elements';
  import type { MetricGridItem } from '../types';

  export type ResourceCountStripProps = HTMLAttributes<HTMLDivElement> & {
    items: MetricGridItem[];
  };
</script>

<script lang="ts">
  import { cn } from '@webperf/ui/utils';
  import { MetricGrid } from '../metric-grid';

  let { items = [], class: className = '', ...rest }: ResourceCountStripProps = $props();
</script>

<div
  {...rest}
  class={cn(
    'rounded-[var(--wp-radius-lg)] border border-line bg-white/[0.03] p-4 shadow-[var(--wp-shadow-soft)]',
    className
  )}
>
  <MetricGrid columns="auto" compact itemClass="shadow-none" {items} />
</div>
