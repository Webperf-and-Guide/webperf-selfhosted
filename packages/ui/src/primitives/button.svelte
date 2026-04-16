<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';
  import { cn } from '../cn';

  let {
    class: className = '',
    variant = 'secondary',
    type = 'button',
    children,
    ...rest
  } = $props<
    HTMLButtonAttributes & {
      class?: string;
      variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
      children?: Snippet;
    }
  >();

  const variantClass = $derived.by(() => {
    switch (variant) {
      case 'primary':
        return 'border-0 bg-gradient-to-br from-accent to-[#ffb05f] font-semibold text-[#101820]';
      case 'ghost':
        return 'border border-line bg-transparent text-muted';
      case 'danger':
        return 'border border-danger/25 bg-danger/10 text-accent-soft';
      default:
        return 'border border-line bg-white/5 text-text';
    }
  });
</script>

<button
  {...rest}
  type={type}
  class={cn(
    'inline-flex items-center justify-center rounded-full px-4 py-2.5 transition-colors duration-200 disabled:cursor-wait disabled:opacity-65',
    variantClass,
    className
  )}
>
  {@render children?.()}
</button>
