<script lang="ts" module>
  import type { HTMLAttributes } from 'svelte/elements';

  export type RegionContinentCardItem = {
    id: string;
    label: string;
    detail: string;
    selected?: boolean;
    disabled?: boolean;
    onSelect?: () => void;
  };

  export type RegionContinentCardProps = HTMLAttributes<HTMLElement> & {
    continent: string;
    itemCount?: number;
    items: RegionContinentCardItem[];
  };
</script>

<script lang="ts">
  import { cn } from '@webperf/ui/utils';
  import { Card } from '@webperf/ui/components/ui/card';
  import { Button } from '@webperf/ui/components/ui/button';

  let {
    continent,
    itemCount,
    items,
    class: className = '',
    ...rest
  }: RegionContinentCardProps = $props();
</script>

<Card {...rest} class={cn('continent-card', className)}>
  <header>
    <h3>{continent}</h3>
    <small>{itemCount ?? items.length} regions</small>
  </header>

  <div class="region-list">
    {#each items as item (item.id)}
      <Button
        class={`region-tile ${item.selected ? 'selected' : ''}`}
        disabled={item.disabled}
        type="button"
        variant="ghost"
        onclick={item.onSelect}
      >
        <strong>{item.label}</strong>
        <span>{item.detail}</span>
      </Button>
    {/each}
  </div>
</Card>
