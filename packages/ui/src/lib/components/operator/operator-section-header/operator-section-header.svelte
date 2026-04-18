<script lang="ts" module>
  import type { HTMLAttributes } from 'svelte/elements';

  export type OperatorSectionHeaderProps = HTMLAttributes<HTMLDivElement> & {
    eyebrow?: string;
    title: string;
    description?: string;
  };
</script>

<script lang="ts">
  import { cn } from '@webperf/ui/utils';

  let {
    eyebrow,
    title,
    description,
    class: className = '',
    ...rest
  }: OperatorSectionHeaderProps = $props();
</script>

<div {...rest} class={cn('section-heading', className)}>
  {#if eyebrow}
    <p class="eyebrow">{eyebrow}</p>
  {/if}

  <h2>{title}</h2>

  {#if description}
    <p class="hint">{description}</p>
  {/if}
</div>
