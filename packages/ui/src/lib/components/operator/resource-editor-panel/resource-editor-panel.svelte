<script lang="ts" module>
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';

  export type ResourceEditorPanelProps = HTMLAttributes<HTMLElement> & {
    title: string;
    description?: string;
    footer?: Snippet<[]>;
    children?: Snippet<[]>;
  };
</script>

<script lang="ts">
  import { cn } from '@webperf/ui/utils';
  import { Card } from '@webperf/ui/components/ui/card';

  let {
    title,
    description,
    footer,
    children,
    class: className = '',
    ...rest
  }: ResourceEditorPanelProps = $props();
</script>

<Card {...rest} class={cn('grid gap-4 p-6', className)}>
  <div class="grid gap-1">
    <strong class="text-lg text-text">{title}</strong>
    {#if description}
      <small class="text-sm leading-6 text-muted">{description}</small>
    {/if}
  </div>

  <div class="grid gap-4">
    {@render children?.()}
  </div>

  {#if footer}
    <div class="flex flex-wrap items-center gap-2">
      {@render footer()}
    </div>
  {/if}
</Card>
