<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';
  import { cn } from '../cn';

  let {
    class: className = '',
    tone = 'muted',
    children,
    ...rest
  } = $props<
    HTMLAttributes<HTMLSpanElement> & {
      class?: string;
      tone?: 'muted' | 'accent' | 'success' | 'danger';
      children?: Snippet;
    }
  >();

  const toneClass = $derived.by(() => {
    switch (tone) {
      case 'accent':
        return 'bg-accent/12 text-accent-soft border-accent/30';
      case 'success':
        return 'bg-success/10 text-success border-success/25';
      case 'danger':
        return 'bg-danger/10 text-accent-soft border-danger/25';
      default:
        return 'bg-white/5 text-muted border-line';
    }
  });
</script>

<span
  {...rest}
  class={cn(
    'inline-flex items-center rounded-full border px-3 py-1 text-[0.72rem] uppercase tracking-[0.14em]',
    toneClass,
    className
  )}
>
  {@render children?.()}
</span>
