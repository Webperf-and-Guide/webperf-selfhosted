<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';
  import { cn } from '../cn';

  let {
    class: className = '',
    tone = 'default',
    children,
    ...rest
  } = $props<
    HTMLAttributes<HTMLDivElement> & {
      class?: string;
      tone?: 'default' | 'strong' | 'quiet';
      children?: Snippet;
    }
  >();

  const toneClass = $derived.by(() => {
    switch (tone) {
      case 'strong':
        return 'bg-surface-strong';
      case 'quiet':
        return 'bg-white/5';
      default:
        return 'bg-surface';
    }
  });
</script>

<div
  {...rest}
  class={cn(
    'rounded-[var(--wp-radius-lg)] border border-line p-5 shadow-[var(--wp-shadow-soft)]',
    toneClass,
    className
  )}
>
  {@render children?.()}
</div>
