<script lang="ts" module>
  import type { HTMLAttributes } from 'svelte/elements';
  import type { ComparisonSummaryData } from '../types';

  export type ComparisonSummaryPanelProps = HTMLAttributes<HTMLDivElement> & {
    panel: ComparisonSummaryData;
  };
</script>

<script lang="ts">
  import { cn } from '@webperf/ui/utils';
  import { Badge } from '@webperf/ui/components/ui/badge';
  import { Card } from '@webperf/ui/components/ui/card';
  import { MetricGrid } from '../metric-grid';
  import OperatorActions from '../_internal/operator-actions.svelte';
  import { badgeTone, metricToneClass } from '../_internal/operator-tone';

  let { panel, class: className = '', ...rest }: ComparisonSummaryPanelProps = $props();
</script>

<Card {...rest} class={cn('grid gap-4', className)} tone="quiet">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="grid gap-1">
      <strong class="text-base text-text">{panel.title}</strong>
      {#if panel.subtitle}
        <small class="text-sm leading-5 text-muted">{panel.subtitle}</small>
      {/if}
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2">
      {#if panel.modeLabel}
        <Badge tone="muted">{panel.modeLabel}</Badge>
      {/if}
      <OperatorActions actions={panel.actions} />
    </div>
  </div>

  <MetricGrid columns="auto" compact items={panel.summary} />

  {#if panel.routes && panel.routes.length > 0}
    <div class="grid gap-4">
      {#each panel.routes as route (route.id)}
        <div class="grid gap-3 rounded-[var(--wp-radius-md)] border border-line/70 bg-white/[0.03] p-4">
          <div class="grid gap-1">
            <strong class="text-sm text-text">{route.title}</strong>
            {#if route.subtitle}
              <small class="text-sm leading-5 text-muted">{route.subtitle}</small>
            {/if}
          </div>

          <div class="grid gap-3 xl:grid-cols-2">
            {#each route.regions as region (region.id)}
              <div
                class={cn(
                  'grid gap-3 rounded-[var(--wp-radius-md)] border p-4 shadow-[var(--wp-shadow-soft)]',
                  metricToneClass(region.tone)
                )}
              >
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <strong class="text-sm text-text">{region.title}</strong>
                  {#if region.classification}
                    <Badge tone={badgeTone(region.tone)}>{region.classification}</Badge>
                  {/if}
                </div>

                <MetricGrid columns={2} compact items={region.stats} />
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</Card>
