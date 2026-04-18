<script lang="ts" module>
  import type { HTMLAttributes } from 'svelte/elements';
  import type { MetricGridItem } from '../types';

  export type MetricGridProps = HTMLAttributes<HTMLDivElement> & {
    items: MetricGridItem[];
    columns?: 2 | 3 | 4 | 6 | 'auto';
    compact?: boolean;
    itemClass?: string;
  };
</script>

<script lang="ts">
  import { cn } from '@webperf/ui/utils';
  import { metricToneClass } from '../_internal/operator-tone';

  let {
    items = [],
    columns = 'auto',
    compact = false,
    itemClass = '',
    class: className = '',
    ...rest
  }: MetricGridProps = $props();

  const gridColumnsClass = $derived.by(() => {
    switch (columns) {
      case 2:
        return 'sm:grid-cols-2';
      case 3:
        return 'sm:grid-cols-2 xl:grid-cols-3';
      case 4:
        return 'sm:grid-cols-2 xl:grid-cols-4';
      case 6:
        return 'sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6';
      default:
        return 'sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4';
    }
  });
</script>

<div {...rest} class={cn('grid gap-3', gridColumnsClass, className)}>
  {#each items as item, index (item.id ?? `${item.label}:${index}`)}
    <div
      class={cn(
        'grid content-start gap-1.5 rounded-[var(--wp-radius-md)] border px-4 py-3.5 shadow-[var(--wp-shadow-soft)]',
        compact ? 'min-h-[5rem]' : 'min-h-[6rem]',
        metricToneClass(item.tone),
        itemClass
      )}
    >
      <span class="text-[0.72rem] uppercase tracking-[0.14em] text-muted">{item.label}</span>
      <strong class="text-base text-text sm:text-lg">{item.value}</strong>
      {#if item.detail}
        <small class="text-sm leading-5 text-muted">{item.detail}</small>
      {/if}
    </div>
  {/each}
</div>
