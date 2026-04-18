<script lang="ts" module>
  import type { HTMLAttributes } from 'svelte/elements';
  import type { PagedListToolbarCopy } from '../types';

  export type PagedListToolbarProps = HTMLAttributes<HTMLElement> & {
    filterValue?: string;
    pageSize?: number;
    visibleCount: number;
    totalCount: number;
    appliedFilter?: string | null;
    canGoPrevious: boolean;
    canGoNext: boolean;
    onApply?: () => void;
    onClear?: () => void;
    onPrevious?: () => void;
    onNext?: () => void;
    onPageSizeChange?: (value: number) => void;
    copy?: PagedListToolbarCopy;
    pageSizeMin?: number;
    pageSizeMax?: number;
    pageSizeStep?: number;
  };
</script>

<script lang="ts">
  import { cn } from '@webperf/ui/utils';
  import { Button } from '@webperf/ui/components/ui/button';
  import { Card } from '@webperf/ui/components/ui/card';
  import { Input } from '@webperf/ui/components/ui/input';
  import {
    NumberField,
    NumberFieldDecrement,
    NumberFieldGroup,
    NumberFieldIncrement,
    NumberFieldInput
  } from '@webperf/ui/components/ui/number-field';

  let {
    filterValue = $bindable(''),
    pageSize = $bindable(6),
    visibleCount,
    totalCount,
    appliedFilter = null,
    canGoPrevious,
    canGoNext,
    onApply,
    onClear,
    onPrevious,
    onNext,
    onPageSizeChange,
    copy = {
      label: 'Browse items',
      filterPlaceholder: 'name, note, status',
      applyLabel: 'Apply',
      clearLabel: 'Clear',
      pageSizeLabel: 'Page size'
    },
    pageSizeMin = 4,
    pageSizeMax = 10,
    pageSizeStep = 2,
    class: className = '',
    ...rest
  }: PagedListToolbarProps = $props();
</script>

<Card {...rest} class={cn('grid gap-4 border-line/70 bg-white/[0.04] p-5', className)} tone="quiet">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="grid gap-1">
      <p class="text-[0.72rem] uppercase tracking-[0.14em] text-muted">Browse state</p>
      <p class="text-sm leading-6 text-muted">
        Showing {visibleCount} of {totalCount}
        {#if appliedFilter}
          for "{appliedFilter}"
        {/if}
      </p>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <Button disabled={!canGoPrevious} onclick={onPrevious} size="sm" type="button" variant="ghost">
        Previous
      </Button>
      <Button disabled={!canGoNext} onclick={onNext} size="sm" type="button" variant="ghost">
        Next
      </Button>
    </div>
  </div>

  <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_11rem_auto] xl:items-end">
    <label class="grid gap-2 text-sm text-muted">
      <span>{copy.label}</span>
      <Input bind:value={filterValue} placeholder={copy.filterPlaceholder ?? ''} />
    </label>

    <label class="grid gap-2 text-sm text-muted">
      <span>{copy.pageSizeLabel ?? 'Page size'}</span>
      <NumberField bind:value={pageSize} max={pageSizeMax} min={pageSizeMin} step={pageSizeStep}>
        <NumberFieldGroup>
          <NumberFieldDecrement />
          <NumberFieldInput
            aria-label={copy.pageSizeLabel ?? 'Page size'}
            oninput={() => onPageSizeChange?.(pageSize)}
          />
          <NumberFieldIncrement />
        </NumberFieldGroup>
      </NumberField>
    </label>

    <div class="flex flex-wrap items-center gap-2 xl:justify-end">
      <Button onclick={onApply} size="sm" type="button" variant="secondary">{copy.applyLabel ?? 'Apply'}</Button>
      {#if onClear}
        <Button onclick={onClear} size="sm" type="button" variant="ghost">{copy.clearLabel ?? 'Clear'}</Button>
      {/if}
    </div>
  </div>
</Card>
