<script lang="ts">
	import { Tabs as TabsPrimitive } from "bits-ui";
	import { cn } from '@webperf/ui/utils';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: TabsPrimitive.TriggerProps = $props();
</script>

<TabsPrimitive.Trigger
	bind:ref
	data-slot="tabs-trigger"
	class={cn(
		"relative inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-transparent px-3 py-1.5 text-sm font-medium text-foreground/60 transition-all has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 hover:text-foreground/88 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
		"group-data-[variant=default]/tabs-list:h-8 group-data-[variant=default]/tabs-list:px-3 group-data-[variant=default]/tabs-list:py-1 group-data-[variant=default]/tabs-list:data-active:border-border/45 group-data-[variant=default]/tabs-list:data-active:bg-white/[0.055] group-data-[variant=default]/tabs-list:data-active:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
		"group-data-[variant=line]/tabs-list:h-9 group-data-[variant=line]/tabs-list:flex-none group-data-[variant=line]/tabs-list:rounded-[var(--wp-radius-pill)] group-data-[variant=line]/tabs-list:px-3.5 group-data-[variant=line]/tabs-list:hover:bg-white/[0.035] group-data-[variant=line]/tabs-list:data-active:bg-white/[0.045] group-data-[variant=line]/tabs-list:data-active:text-foreground group-data-[variant=line]/tabs-list:data-active:shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]",
		"after:absolute after:opacity-0 after:transition-opacity after:content-[''] group-data-[orientation=horizontal]/tabs:after:inset-x-3 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=horizontal]/tabs:after:rounded-full group-data-[orientation=vertical]/tabs:after:inset-y-1 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[orientation=vertical]/tabs:after:rounded-full group-data-[variant=line]/tabs-list:after:bg-primary group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
		className
	)}
	{...restProps}
/>
