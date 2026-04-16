<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '../cn';

  let { class: className = '', ...rest } = $props<HTMLAttributes<HTMLDivElement> & { class?: string }>();
</script>

<div {...rest} role="separator" class={cn('h-px w-full bg-line', className)}></div>
