<script lang="ts">
	import { cn } from '@webperf/ui/utils';
	import { useNumberFieldInput } from './number-field.svelte.js';
	import type { NumberFieldInputProps } from './types.js';

	let { ref = $bindable(null), class: className, ...rest }: NumberFieldInputProps = $props();

	const inputState = useNumberFieldInput();
</script>

<input
	class={cn(
		'aria-invalid:border-destructive h-10 min-w-[4.25rem] flex-1 border-line/80 bg-surface-strong/70 px-3 text-center text-sm font-medium text-text outline-none transition-colors duration-200 focus:border-accent/50',
		className
	)}
	bind:this={ref}
	data-slot="number-field-input"
	bind:value={inputState.rootState.opts.value.current}
	{...inputState.props}
	{...rest}
/>

<style>
	input[type='number'] {
		appearance: none;
		-moz-appearance: textfield;
	}

	input[type='number']::-webkit-outer-spin-button,
	input[type='number']::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
</style>
