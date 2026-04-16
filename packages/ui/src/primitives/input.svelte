<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { cn } from '../cn';

  let { class: className = '', value = $bindable(), ...rest } = $props<
    HTMLInputAttributes & { class?: string }
  >();
</script>

<input
  {...rest}
  bind:value
  class={cn(
    'w-full rounded-[var(--wp-radius-sm)] border border-line bg-surface-strong/70 px-4 py-3 text-text outline-none transition-colors duration-200 placeholder:text-muted/70 focus:border-accent/50',
    className
  )}
/>
