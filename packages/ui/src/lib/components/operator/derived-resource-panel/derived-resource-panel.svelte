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
  import { Input } from '@webperf/ui/components/ui/input';
  import {
    NumberField,
    NumberFieldDecrement,
    NumberFieldGroup,
    NumberFieldIncrement,
    NumberFieldInput
  } from '@webperf/ui/components/ui/number-field';
  import {
    UnderlineTabs,
    UnderlineTabsList,
    UnderlineTabsTrigger
  } from '@webperf/ui/components/ui/underline-tabs';
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

    <div class="grid gap-3">
      <UnderlineTabs value={kind} class="w-full min-w-[18rem]">
        <UnderlineTabsList>
          {#each tabs as tab (tab.value)}
            <UnderlineTabsTrigger
              onclick={() => {
                kind = tab.value;
                onKindChange?.(tab.value);
              }}
              value={tab.value}
            >
              {tab.label}
            </UnderlineTabsTrigger>
          {/each}
        </UnderlineTabsList>
      </UnderlineTabs>

      <label class="grid gap-2 text-sm text-muted">
        <span>Page size</span>
        <NumberField bind:value={pageSize} max={10} min={4} step={2}>
          <NumberFieldGroup>
            <NumberFieldDecrement />
            <NumberFieldInput
              aria-label="Derived resource page size"
              oninput={() => onPageSizeChange?.(pageSize)}
            />
            <NumberFieldIncrement />
          </NumberFieldGroup>
        </NumberField>
      </label>
    </div>
  </div>

  <div class="flex flex-col gap-3 lg:flex-row">
    <label class="grid grow gap-2 text-sm text-muted">
      <span>Filter</span>
      <Input bind:value={filterValue} placeholder="name, id, status, source" />
    </label>
    <div class="flex items-end">
      <Button onclick={onApplyFilter} type="button" variant="secondary">Apply</Button>
    </div>
  </div>

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

  <div class="flex flex-wrap items-center justify-between gap-3">
    <small class="text-sm text-muted">
      Showing {visibleCount} of {totalCount}
      {#if appliedFilter}
        for "{appliedFilter}"
      {/if}
    </small>

    <div class="flex flex-wrap items-center gap-2">
      <Button disabled={!canGoPrevious} onclick={onPrevious} type="button" variant="ghost">
        Previous
      </Button>
      <Button disabled={!canGoNext} onclick={onNext} type="button" variant="ghost">
        Next
      </Button>
    </div>
  </div>
</section>
