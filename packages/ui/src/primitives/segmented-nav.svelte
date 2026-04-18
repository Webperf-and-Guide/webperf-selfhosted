<script lang="ts">
  import { cn } from '../cn';

  type Item = {
    href: string;
    label: string;
  };

  let {
    items,
    class: className = ''
  } = $props<{
    items: Item[];
    class?: string;
  }>();
</script>

<nav class={cn('flex flex-wrap gap-2', className)}>
  {#each items as item (item.href)}
    <a
      class="inline-flex items-center rounded-full border border-line/55 bg-white/[0.035] px-3.5 py-2 text-[0.92rem] text-accent-soft shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors duration-200 hover:border-accent/28 hover:bg-white/[0.06] hover:text-text"
      href={item.href}
    >
      {item.label}
    </a>
  {/each}
</nav>
