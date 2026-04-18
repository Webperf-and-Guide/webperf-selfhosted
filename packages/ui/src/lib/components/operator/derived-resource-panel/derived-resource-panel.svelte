<script lang="ts" module>
  import type { HTMLAttributes } from 'svelte/elements';
  import type { DerivedResourceItem, DerivedResourceTab } from '../types';

  export type DerivedResourcePanelProps = HTMLAttributes<HTMLElement> & {
    eyebrow?: string;
    title: string;
    description?: string;
    kind?: string;
    tabs: DerivedResourceTab[];
    filterValue?: string;
    pageSize?: number;
    items: DerivedResourceItem[];
    isPending?: boolean;
    errorMessage?: string | null;
    totalCount: number;
    appliedFilter?: string | null;
    canGoPrevious: boolean;
    canGoNext: boolean;
    emptyTitle?: string;
    emptyDetail?: string;
    onKindChange?: (value: string) => void;
    onApplyFilter?: () => void;
    onPrevious?: () => void;
    onNext?: () => void;
    onPageSizeChange?: (value: number) => void;
  };
</script>

<script lang="ts">
  import { cn } from '@webperf/ui/utils';
  import { Button } from '@webperf/ui/components/ui/button';
  import { Card } from '@webperf/ui/components/ui/card';
  import { MetricGrid } from '../metric-grid';
  import { PagedListToolbar } from '../paged-list-toolbar';
  import { Tabs, TabsList, TabsTrigger } from '@webperf/ui/components/ui/tabs';
  import { metricToneClass } from '../_internal/operator-tone';

  let {
    eyebrow = 'Derived resources',
    title,
    description = '',
    kind = $bindable('comparisons'),
    tabs = [],
    filterValue = $bindable(''),
    pageSize = $bindable(6),
    items = [],
    isPending = false,
    errorMessage = null,
    totalCount,
    appliedFilter = null,
    canGoPrevious,
    canGoNext,
    emptyTitle = 'No items matched this view.',
    emptyDetail = 'Try clearing the filter or generating a fresh run first.',
    onKindChange,
    onApplyFilter,
    onPrevious,
    onNext,
    onPageSizeChange,
    class: className = '',
    ...rest
  }: DerivedResourcePanelProps = $props();

  const visibleCount = $derived.by(() => items.length);
  const browseSummaryItems = $derived.by(() => [
    {
      id: 'visible',
      label: 'Visible now',
      value: `${visibleCount} of ${totalCount}`,
      detail: 'Current derived view after client-side paging.'
    },
    {
      id: 'kind',
      label: 'Resource type',
      value: kind,
      detail: 'Comparisons, exports, or analyses.'
    },
    {
      id: 'filter',
      label: 'Active filter',
      value: appliedFilter ?? 'none',
      detail: appliedFilter ? 'Scoped list.' : 'No filter applied.'
    },
    {
      id: 'page-size',
      label: 'Page size',
      value: pageSize,
      detail: 'Derived items shown per page.'
    }
  ]);
</script>

<section
  {...rest}
  class={cn(
    'grid gap-5 rounded-[var(--wp-radius-xl)] border border-line bg-white/[0.03] p-6 shadow-[var(--wp-shadow-soft)]',
    className
  )}
>
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="grid gap-2">
      <div class="grid gap-1">
        <p class="text-[0.72rem] uppercase tracking-[0.14em] text-muted">{eyebrow}</p>
        <h3 class="text-xl font-semibold text-text">{title}</h3>
      </div>
      {#if description}
        <p class="max-w-2xl text-sm leading-6 text-muted">{description}</p>
      {/if}
    </div>

    <div class="grid gap-3 xl:min-w-[22rem]">
      <Tabs value={kind}>
        <TabsList variant="default" class="w-full justify-start">
          {#each tabs as tab (tab.value)}
            <TabsTrigger
              onclick={() => {
                kind = tab.value;
                onKindChange?.(tab.value);
              }}
              value={tab.value}
            >
              {tab.label}
            </TabsTrigger>
          {/each}
        </TabsList>
      </Tabs>
    </div>
  </div>

  <MetricGrid compact items={browseSummaryItems} />

  <PagedListToolbar
    appliedFilter={appliedFilter}
    canGoNext={canGoNext}
    canGoPrevious={canGoPrevious}
    bind:filterValue
    bind:pageSize
    copy={{
      label: 'Filter derived resources',
      filterPlaceholder: 'name, id, status, source',
      applyLabel: 'Apply',
      clearLabel: 'Clear',
      pageSizeLabel: 'Page size'
    }}
    onApply={onApplyFilter}
    onClear={() => {
      filterValue = '';
      onApplyFilter?.();
    }}
    onNext={onNext}
    onPageSizeChange={onPageSizeChange}
    onPrevious={onPrevious}
    totalCount={totalCount}
    visibleCount={visibleCount}
  />

  {#if isPending}
    <div class="rounded-[var(--wp-radius-md)] border border-line/70 bg-white/[0.02] px-4 py-6 text-sm text-muted">
      Loading {kind}...
    </div>
  {:else if errorMessage}
    <p class="text-sm leading-6 text-danger">{errorMessage}</p>
  {:else if items.length === 0}
    <div class="rounded-[var(--wp-radius-md)] border border-line/70 bg-white/[0.02] px-4 py-6">
      <p class="text-sm font-medium text-text">{emptyTitle}</p>
      <small class="mt-1 block text-sm leading-5 text-muted">{emptyDetail}</small>
    </div>
  {:else}
    <div class="grid gap-3 xl:grid-cols-2">
      {#each items as item (item.id)}
        <Card class={cn('grid gap-3', metricToneClass(item.tone))}>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <strong class="break-all text-sm text-text">{item.id}</strong>
            <span class="text-xs uppercase tracking-[0.14em] text-muted">{item.createdAtLabel}</span>
          </div>

          <div class="grid gap-2">
            {#each item.summary as summary (`${item.id}:${summary}`)}
              <div class="text-sm leading-6 text-muted">{summary}</div>
            {/each}
          </div>
        </Card>
      {/each}
    </div>
  {/if}

  {#if items.length > 0}
    <div class="flex flex-wrap items-center justify-between gap-3">
      <small class="text-sm text-muted">
        Recent derived payloads stay on the client so the operator can scan them without leaving the workspace.
      </small>
      <Button onclick={onApplyFilter} size="sm" type="button" variant="ghost">Refresh view</Button>
    </div>
  {/if}
</section>
