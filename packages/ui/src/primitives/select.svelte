<script lang="ts">
  import type { HTMLSelectAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';
  import { cn } from '../cn';

  let { class: className = '', value = $bindable(), children, ...rest } = $props<
    HTMLSelectAttributes & { class?: string; children?: Snippet }
  >();
</script>

<select
  {...rest}
  bind:value
  class={cn(
    'w-full rounded-[var(--wp-radius-sm)] border border-line bg-surface-strong/70 px-4 py-3 text-text outline-none transition-colors duration-200 focus:border-accent/50',
    className
  )}
>
  {@render children?.()}
</select>
