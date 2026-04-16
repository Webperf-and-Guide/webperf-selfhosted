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
      class="inline-flex items-center rounded-full border border-line bg-white/5 px-3 py-2 text-[0.92rem] text-accent-soft transition-colors duration-200 hover:bg-white/10"
      href={item.href}
    >
      {item.label}
    </a>
  {/each}
</nav>
