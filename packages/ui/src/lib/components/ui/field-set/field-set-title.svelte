<script lang="ts">
	import { cn } from '@webperf/ui/utils';
	import type { FieldSetTitleProps } from './types';

	let {
		ref = $bindable(null),
		class: className,
		level = 3,
		children,
		...rest
	}: FieldSetTitleProps = $props();
</script>

<div
	bind:this={ref}
	role="heading"
	aria-level={level}
	bind:this={ref}
	class={cn('px-6 pt-5 text-2xl leading-none font-semibold tracking-tight', className)}
	{...rest}
>
	{@render children?.()}
</div>
