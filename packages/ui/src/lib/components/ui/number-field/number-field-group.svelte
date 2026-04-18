<script lang="ts">
	import { cn, type WithElementRef } from '@webperf/ui/utils';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...rest
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	class={cn(
		'flex h-10 items-center overflow-hidden rounded-[var(--wp-radius-sm)] border border-line/60 bg-surface-strong/55 shadow-[var(--wp-shadow-soft)]',
		'*:data-[slot=number-field-increment]:h-full *:data-[slot=number-field-increment]:w-11 *:data-[slot=number-field-increment]:rounded-none *:data-[slot=number-field-increment]:border-0 *:data-[slot=number-field-increment]:bg-transparent *:data-[slot=number-field-increment]:shadow-none *:data-[slot=number-field-increment]:focus-visible:ring-0',
		'*:data-[slot=number-field-decrement]:h-full *:data-[slot=number-field-decrement]:w-11 *:data-[slot=number-field-decrement]:rounded-none *:data-[slot=number-field-decrement]:border-0 *:data-[slot=number-field-decrement]:bg-transparent *:data-[slot=number-field-decrement]:shadow-none *:data-[slot=number-field-decrement]:focus-visible:ring-0',
		'*:data-[slot=number-field-input]:rounded-none *:data-[slot=number-field-input]:border-x *:data-[slot=number-field-input]:border-y-0 *:data-[slot=number-field-input]:first:border-s-0 *:data-[slot=number-field-input]:last:border-e-0',
		className
	)}
	{...rest}
>
	{@render children?.()}
</div>
