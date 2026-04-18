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
    primaryActions?: OperatorActionItem[];
    secondaryActions?: OperatorActionItem[];
    summary: MetricGridItem[];
    reportPanel?: ComparisonSummaryData | null;
    comparisonPanels?: ComparisonSummaryData[];
    comparisonEmptyMessage?: string;
    runHistory?: RunHistoryEntry[];
  };
</script>

<script lang="ts">
  import { cn } from '@webperf/ui/utils';
  import { Badge } from '@webperf/ui/components/ui/badge';
  import { Button } from '@webperf/ui/components/ui/button';
  import { Card } from '@webperf/ui/components/ui/card';
  import { MetricGrid } from '../metric-grid';
  import { ComparisonSummaryPanel } from '../comparison-summary-panel';
  import OperatorActions from '../_internal/operator-actions.svelte';

  let {
    title,
    meta,
    note,
    primaryActions = [],
    secondaryActions = [],
    summary = [],
    reportPanel = null,
    comparisonPanels = [],
    comparisonEmptyMessage = '',
    runHistory = [],
    class: className = '',
    ...rest
  }: SavedCheckSummaryCardProps = $props();

  let detailsExpanded = $state(false);
  let reportOpen = $state(true);
  let comparisonsOpen = $state(false);
  let runHistoryOpen = $state(false);
  let expandedRunEntryIds = $state<string[]>([]);

  const canExpand = $derived.by(
    () => secondaryActions.length > 0 || comparisonPanels.length > 0 || runHistory.length > 0
  );

  const collapsedSummary = $derived.by(() => {
    const parts: string[] = [];

    if (comparisonPanels.length > 0) {
      parts.push(`${comparisonPanels.length} comparison ${comparisonPanels.length === 1 ? 'panel' : 'panels'}`);
    }

    if (runHistory.length > 0) {
      parts.push(`${runHistory.length} recent ${runHistory.length === 1 ? 'run' : 'runs'}`);
    }

    if (secondaryActions.length > 0) {
      parts.push(`${secondaryActions.length} more actions`);
    }

    return parts.join(' · ');
  });

  const isRunEntryExpanded = (entryId: string) => expandedRunEntryIds.includes(entryId);

  const toggleRunEntry = (entryId: string) => {
    expandedRunEntryIds = isRunEntryExpanded(entryId)
      ? expandedRunEntryIds.filter((id) => id !== entryId)
      : [...expandedRunEntryIds, entryId];
  };
</script>

<Card {...rest} class={cn('grid gap-5', className)}>
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="grid gap-1">
      <strong class="text-base text-text">{title}</strong>
      <p class="text-sm text-muted">{meta}</p>
      {#if note}
        <p class="text-sm leading-6 text-muted">{note}</p>
      {/if}
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2">
      <OperatorActions actions={primaryActions} />
      {#if canExpand}
        <Button onclick={() => (detailsExpanded = !detailsExpanded)} size="sm" type="button" variant="ghost">
          {#if detailsExpanded}Hide details{:else}Show details{/if}
        </Button>
      {/if}
    </div>
  </div>

  {#if detailsExpanded && secondaryActions.length > 0}
    <div class="flex flex-wrap items-center justify-between gap-3 rounded-[var(--wp-radius-md)] border border-line/70 bg-white/[0.03] px-4 py-3">
      <div class="grid gap-1">
        <span class="text-[0.72rem] uppercase tracking-[0.16em] text-muted">Detail actions</span>
        <p class="text-sm text-muted">Editing and destructive actions stay tucked behind the expanded view.</p>
      </div>
      <OperatorActions actions={secondaryActions} />
    </div>
  {:else if !detailsExpanded && collapsedSummary}
    <div class="flex flex-wrap items-center gap-2 text-sm text-muted">
      <Badge tone="muted">Summary-first</Badge>
      <span>{collapsedSummary}</span>
    </div>
  {/if}

  <MetricGrid columns="auto" compact items={summary} />

  {#if reportPanel}
    <div class="grid gap-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="grid gap-1">
          <strong class="text-sm text-text">Latest report</strong>
          <p class="text-sm text-muted">Keep the latest verdict visible even while the rest of the card stays compact.</p>
        </div>
        <Button onclick={() => (reportOpen = !reportOpen)} size="sm" type="button" variant="ghost">
          {#if reportOpen}Hide report{:else}Show report{/if}
        </Button>
      </div>

      {#if reportOpen}
        <ComparisonSummaryPanel panel={reportPanel} />
      {/if}
    </div>
  {/if}

  {#if detailsExpanded}
    {#if comparisonPanels.length > 0}
      <div class="grid gap-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="grid gap-1">
            <strong class="text-sm text-text">Comparisons</strong>
            <p class="text-sm text-muted">Expand route-by-route differences only when you need the full diff.</p>
          </div>
          <Button onclick={() => (comparisonsOpen = !comparisonsOpen)} size="sm" type="button" variant="ghost">
            {#if comparisonsOpen}Hide comparisons{:else}Show comparisons{/if}
          </Button>
        </div>

        {#if comparisonsOpen}
          <div class="grid gap-4">
            {#each comparisonPanels as panel (panel.id)}
              <ComparisonSummaryPanel {panel} />
            {/each}
          </div>
        {/if}
      </div>
    {:else if comparisonEmptyMessage}
      <p class="text-sm leading-6 text-muted">{comparisonEmptyMessage}</p>
    {/if}

    {#if runHistory.length > 0}
      <div class="grid gap-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="grid gap-1">
            <strong class="text-sm text-text">Recent run history</strong>
            <p class="text-sm text-muted">Review run summaries first, then open target details only for the runs you need.</p>
          </div>
          <Button onclick={() => (runHistoryOpen = !runHistoryOpen)} size="sm" type="button" variant="ghost">
            {#if runHistoryOpen}Hide run history{:else}Show run history{/if}
          </Button>
        </div>

        {#if runHistoryOpen}
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

                  <div class="flex flex-wrap items-center justify-end gap-2">
                    <OperatorActions actions={entry.actions} />
                    <Button onclick={() => toggleRunEntry(entry.id)} size="sm" type="button" variant="ghost">
                      {#if isRunEntryExpanded(entry.id)}Hide target details{:else}Show target details{/if}
                    </Button>
                  </div>
                </div>

                <MetricGrid columns="auto" compact items={entry.summary} />

                {#if isRunEntryExpanded(entry.id)}
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
                {/if}
              </Card>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</Card>
