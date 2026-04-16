<script lang="ts" module>
  import type { HTMLAttributes } from 'svelte/elements';
  import type {
    ComparisonSummaryData,
    MetricGridItem,
    OperatorActionItem,
    RunHistoryEntry
  } from '../types';

  export type SavedCheckSummaryCardProps = HTMLAttributes<HTMLDivElement> & {
    title: string;
    meta: string;
    note?: string;
    actions?: OperatorActionItem[];
    summary: MetricGridItem[];
    reportPanel?: ComparisonSummaryData | null;
    comparisonPanels?: ComparisonSummaryData[];
    comparisonEmptyMessage?: string;
    runHistory?: RunHistoryEntry[];
  };
</script>

<script lang="ts">
  import { cn } from '@webperf/ui/utils';
  import { Card } from '@webperf/ui/components/ui/card';
  import { MetricGrid } from '../metric-grid';
  import { ComparisonSummaryPanel } from '../comparison-summary-panel';
  import OperatorActions from '../_internal/operator-actions.svelte';

  let {
    title,
    meta,
    note,
    actions = [],
    summary = [],
    reportPanel = null,
    comparisonPanels = [],
    comparisonEmptyMessage = '',
    runHistory = [],
    class: className = '',
    ...rest
  }: SavedCheckSummaryCardProps = $props();
</script>

<Card {...rest} class={cn('grid gap-5', className)}>
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="grid gap-1">
      <strong class="text-base text-text">{title}</strong>
      <p class="text-sm text-muted">{meta}</p>
    </div>

    <OperatorActions actions={actions} />
  </div>

  {#if note}
    <p class="text-sm leading-6 text-muted">{note}</p>
  {/if}

  <MetricGrid columns="auto" compact items={summary} />

  {#if reportPanel}
    <ComparisonSummaryPanel panel={reportPanel} />
  {/if}

  {#if comparisonPanels.length > 0}
    <div class="grid gap-4">
      {#each comparisonPanels as panel (panel.id)}
        <ComparisonSummaryPanel {panel} />
      {/each}
    </div>
  {:else if comparisonEmptyMessage}
    <p class="text-sm leading-6 text-muted">{comparisonEmptyMessage}</p>
  {/if}

  {#if runHistory.length > 0}
    <div class="grid gap-4">
      {#each runHistory as entry (entry.id)}
        <Card class="grid gap-4" tone="quiet">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="grid gap-1">
              <strong class="text-sm text-text">{entry.title}</strong>
              {#if entry.subtitle}
                <small class="text-sm leading-5 text-muted">{entry.subtitle}</small>
              {/if}
            </div>

            <OperatorActions actions={entry.actions} />
          </div>

          <MetricGrid columns="auto" compact items={entry.summary} />

          <div class="grid gap-3 xl:grid-cols-2">
            {#each entry.jobs as job (job.id)}
              <div class="grid gap-3 rounded-[var(--wp-radius-md)] border border-line/70 bg-white/[0.03] p-4">
                <div class="grid gap-1">
                  <strong class="text-sm text-text">{job.title}</strong>
                  {#if job.subtitle}
                    <small class="text-sm leading-5 text-muted">{job.subtitle}</small>
                  {/if}
                </div>

                <div class="grid gap-2 sm:grid-cols-2">
                  {#each job.targets as target (target.id)}
                    <div class="grid gap-1 rounded-[var(--wp-radius-md)] border border-line/60 bg-white/[0.02] px-3 py-2">
                      <span class="text-[0.72rem] uppercase tracking-[0.14em] text-muted">
                        {target.label}
                      </span>
                      <strong class="text-sm text-text">{target.value}</strong>
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </Card>
      {/each}
    </div>
  {/if}
</Card>
