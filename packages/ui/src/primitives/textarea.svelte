<script lang="ts">
  import type { HTMLTextareaAttributes } from 'svelte/elements';
  import { cn } from '../cn';

  let { class: className = '', value = $bindable(), ...rest } = $props<
    HTMLTextareaAttributes & { class?: string }
  >();
</script>

<textarea
  {...rest}
  bind:value
  class={cn(
    'min-h-24 w-full resize-y rounded-[var(--wp-radius-sm)] border border-line bg-surface-strong/70 px-4 py-3 text-text outline-none transition-colors duration-200 placeholder:text-muted/70 focus:border-accent/50',
    className
  )}
></textarea>
