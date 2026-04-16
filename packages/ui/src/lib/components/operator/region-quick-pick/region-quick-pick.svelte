<script lang="ts" module>
  import type { HTMLAttributes } from 'svelte/elements';
  import type { RegionQuickPickItem } from '../types';

  export type RegionQuickPickProps = HTMLAttributes<HTMLDivElement> & {
    items: RegionQuickPickItem[];
    label?: string;
    summary?: string;
  };
</script>

<script lang="ts">
  import { cn } from '@webperf/ui/utils';
  import { Button } from '@webperf/ui/components/ui/button';

  let {
    items = [],
    label = 'Quick region picks',
    summary = '',
    class: className = '',
    ...rest
  }: RegionQuickPickProps = $props();
</script>

<div {...rest} class={cn('grid gap-3', className)}>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <span class="text-[0.72rem] uppercase tracking-[0.14em] text-muted">{label}</span>
    {#if summary}
      <strong class="text-sm text-text">{summary}</strong>
    {/if}
  </div>

  <div class="flex flex-wrap gap-2">
    {#each items as item (item.id)}
      <Button
        class={cn(
          'min-w-[7rem] justify-between rounded-full border border-line/80 bg-white/[0.03] px-3',
          item.selected && 'border-accent/40 bg-accent/8 text-accent'
        )}
        disabled={item.disabled}
        onclick={item.onclick}
        type="button"
        variant="ghost"
      >
        <span>{item.label}</span>
      </Button>
    {/each}
  </div>
</div>
