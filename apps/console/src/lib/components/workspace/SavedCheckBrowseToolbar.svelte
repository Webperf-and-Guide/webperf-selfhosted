<script lang="ts">
  import { MetricGrid } from '@webperf/ui/components/operator/metric-grid';
  import { PagedListToolbar } from '@webperf/ui/components/operator/paged-list-toolbar';
  import type { MetricGridItem } from '@webperf/ui/components/operator/types';

  let {
    browseSummaryItems,
    appliedFilter,
    filterValue = $bindable(''),
    pageSize = $bindable(6),
    canGoNext,
    canGoPrevious,
    onApply,
    onClear,
    onNext,
    onPageSizeChange,
    onPrevious,
    totalCount,
    visibleCount
  } = $props<{
    browseSummaryItems: MetricGridItem[];
    appliedFilter?: string | null;
    filterValue?: string;
    pageSize?: number;
    canGoNext: boolean;
    canGoPrevious: boolean;
    onApply: () => void;
    onClear: () => void;
    onNext: () => void;
    onPageSizeChange: () => void;
    onPrevious: () => void;
    totalCount: number;
    visibleCount: number;
  }>();
</script>

<div class="grid gap-4">
  <MetricGrid class="rounded-[var(--wp-radius-lg)] border border-line/55 bg-white/[0.025] p-4" compact items={browseSummaryItems} />

  <PagedListToolbar
    {appliedFilter}
    bind:filterValue
    bind:pageSize
    {canGoNext}
    {canGoPrevious}
    copy={{
      label: 'Browse saved checks',
      filterPlaceholder: 'check name, note, site, route group',
      applyLabel: 'Apply',
      clearLabel: 'Clear',
      pageSizeLabel: 'Page size'
    }}
    onApply={onApply}
    onClear={onClear}
    onNext={onNext}
    onPageSizeChange={onPageSizeChange}
    onPrevious={onPrevious}
    {totalCount}
    {visibleCount}
  />
</div>
