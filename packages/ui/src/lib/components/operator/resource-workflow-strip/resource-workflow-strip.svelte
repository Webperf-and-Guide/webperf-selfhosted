<script lang="ts" module>
  import type { HTMLAttributes } from 'svelte/elements';
  import type { ResourceWorkflowItem } from '../types';

  export type ResourceWorkflowStripProps = HTMLAttributes<HTMLElement> & {
    items: ResourceWorkflowItem[];
  };
</script>

<script lang="ts">
  import { cn } from '@webperf/ui/utils';
  import { Card } from '@webperf/ui/components/ui/card';

  let {
    items = [],
    class: className = '',
    ...rest
  }: ResourceWorkflowStripProps = $props();
</script>

<div
  {...rest}
  class={cn('grid gap-3 lg:grid-cols-3', className)}
>
  {#each items as item, index (item.id ?? `${item.label}:${index}`)}
    <Card class="grid gap-2" tone="quiet">
      <span class="text-[0.72rem] uppercase tracking-[0.14em] text-muted">{item.label}</span>
      <strong class="text-base text-text">{item.title}</strong>
      <small class="text-sm leading-6 text-muted">{item.detail}</small>
    </Card>
  {/each}
</div>
