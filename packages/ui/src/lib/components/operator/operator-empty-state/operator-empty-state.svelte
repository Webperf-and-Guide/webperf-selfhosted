<script lang="ts" module>
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';

  export type OperatorEmptyStateProps = HTMLAttributes<HTMLDivElement> & {
    title: string;
    detail?: string;
    children?: Snippet<[]>;
  };
</script>

<script lang="ts">
  import { cn } from '@webperf/ui/utils';

  let {
    title,
    detail,
    children,
    class: className = '',
    ...rest
  }: OperatorEmptyStateProps = $props();
</script>

<div {...rest} class={cn('empty-state', className)}>
  <p>{title}</p>

  {#if detail}
    <small>{detail}</small>
  {/if}

  {@render children?.()}
</div>
