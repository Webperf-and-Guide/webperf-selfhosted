<script lang="ts">
  import { browser } from '$app/environment';
  import { createQuery } from '@tanstack/svelte-query';
  import Button from '@webperf/ui/components/ui/button';
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
  import type {
    AnalysisListResponse,
    AnalysisResource,
    ComparisonListResponse,
    ComparisonResource,
    ExportListResponse,
    ExportResource,
    PageInfo
  } from '@webperf/contracts';
  import { fetchControlJson } from '$lib/client/control-query';

  type ResourceKind = 'comparisons' | 'exports' | 'analyses';
  type ResourceListResponse = ComparisonListResponse | ExportListResponse | AnalysisListResponse;
  type ResourceItem = ComparisonResource | ExportResource | AnalysisResource;

  const emptyPageInfo: PageInfo = {
    pageSize: 6,
    totalCount: 0,
    nextPageToken: null,
    filter: null
  };

  let kind = $state<ResourceKind>('comparisons');
  let filterDraft = $state('');
  let filter = $state('');
  let pageSize = $state(6);
  let pageToken = $state<string | null>(null);
  let previousTokens = $state<string[]>([]);

  const resourceQuery = createQuery(() => ({
    queryKey: ['control', 'derived', kind, filter, pageSize, pageToken],
    enabled: browser,
    queryFn: async () => {
      const query = {
        pageSize,
        pageToken,
        filter: filter || null
      };

      switch (kind) {
        case 'comparisons':
          return fetchControlJson<ComparisonListResponse>('comparisons', query);
        case 'exports':
          return fetchControlJson<ExportListResponse>('exports', query);
        default:
          return fetchControlJson<AnalysisListResponse>('analyses', query);
      }
    }
  }));

  const getPageInfo = (data: ResourceListResponse | undefined): PageInfo => {
    if (!data) {
      return emptyPageInfo;
    }
    return data.pageInfo;
  };

  const getItems = (data: ResourceListResponse | undefined): ResourceItem[] => {
    if (!data) {
      return [];
    }

    if ('comparisons' in data) {
      return data.comparisons;
    }

    if ('exports' in data) {
      return data.exports;
    }

    return data.analyses;
  };

  const pageInfo = $derived.by<PageInfo>(() => getPageInfo(resourceQuery.data));
  const items = $derived.by<ResourceItem[]>(() => getItems(resourceQuery.data));

  const resetPaging = () => {
    pageToken = null;
    previousTokens = [];
  };

  const applyFilter = () => {
    filter = filterDraft.trim();
    resetPaging();
  };

  const changeKind = (nextKind: ResourceKind) => {
    kind = nextKind;
    filterDraft = '';
    filter = '';
    resetPaging();
  };

  const goToNextPage = () => {
    if (!pageInfo.nextPageToken) {
      return;
    }

    previousTokens = [...previousTokens, pageToken ?? '0'];
    pageToken = pageInfo.nextPageToken;
  };

  const goToPreviousPage = () => {
    if (previousTokens.length === 0) {
      return;
    }

    const nextHistory = [...previousTokens];
    const previousToken = nextHistory.pop() ?? '0';
    previousTokens = nextHistory;
    pageToken = previousToken === '0' ? null : previousToken;
  };

  const summarizeItem = (item: ResourceItem) => {
    if (kind === 'comparisons') {
      const comparison = item as ComparisonResource;
      return [
        `Check ${comparison.checkId}`,
        `${comparison.summary.regressed} regressed`,
        `${comparison.summary.improved} improved`
      ];
    }

    if (kind === 'exports') {
      const exportResource = item as ExportResource;
      return [
        `${exportResource.source.type}`,
        exportResource.format.toUpperCase(),
        exportResource.status
      ];
    }

    const analysis = item as AnalysisResource;
    return [
      analysis.kind,
      analysis.status,
      analysis.output.findings[0]?.summary ?? analysis.output.narrative ?? 'No findings yet'
    ];
  };
</script>

<section class="derived-section">
  <div class="section-heading compact">
    <div>
      <p class="eyebrow">Derived resources</p>
      <h3>Comparisons, exports, and analyses now page on the client.</h3>
    </div>

      <div class="toolbar">
        <UnderlineTabs value={kind} class="w-full max-w-xl">
          <UnderlineTabsList>
            {#each ['comparisons', 'exports', 'analyses'] as option (option)}
              <UnderlineTabsTrigger value={option} onclick={() => changeKind(option as ResourceKind)}>
                {option}
              </UnderlineTabsTrigger>
            {/each}
          </UnderlineTabsList>
        </UnderlineTabs>

        <label class="field inline-field">
          <span>Page size</span>
          <NumberField bind:value={pageSize} max={10} min={4} step={2}>
            <NumberFieldGroup>
              <NumberFieldDecrement />
              <NumberFieldInput aria-label="Derived resource page size" oninput={() => resetPaging()} />
              <NumberFieldIncrement />
            </NumberFieldGroup>
          </NumberField>
        </label>
      </div>
  </div>

  <div class="list-controls">
    <label class="field grow">
      <span>Filter</span>
      <Input bind:value={filterDraft} placeholder="name, id, status, source" />
    </label>
    <Button variant="secondary" type="button" onclick={applyFilter}>Apply</Button>
  </div>

  {#if resourceQuery.isPending}
    <div class="empty-state">
      <p>Loading {kind}…</p>
    </div>
  {:else if resourceQuery.isError}
    <p class="error">{resourceQuery.error?.message ?? `Failed to load ${kind}.`}</p>
  {:else if items.length === 0}
    <div class="empty-state">
      <p>No {kind} matched this view.</p>
      <small>Try clearing the filter or generating a fresh run first.</small>
    </div>
  {:else}
    <div class="derived-grid">
      {#each items as item (item.id)}
        <Card class="derived-card">
          <div class="derived-head">
            <strong>{item.id}</strong>
            <span>{new Date(item.createdAt).toLocaleString()}</span>
          </div>

          <div class="derived-summary">
            {#each summarizeItem(item) as summary (`${item.id}:${summary}`)}
              <div>{summary}</div>
            {/each}
          </div>
        </Card>
      {/each}
    </div>
  {/if}

  <div class="pagination-bar">
    <small>
      Showing {items.length} of {pageInfo.totalCount}
      {#if pageInfo.filter}
        for "{pageInfo.filter}"
      {/if}
    </small>

    <div class="saved-actions">
      <Button variant="ghost" type="button" onclick={goToPreviousPage} disabled={previousTokens.length === 0}>
        Previous
      </Button>
      <Button variant="ghost" type="button" onclick={goToNextPage} disabled={!pageInfo.nextPageToken}>
        Next
      </Button>
    </div>
  </div>
</section>

<style>
  .derived-section {
    display: grid;
    gap: 18px;
    padding: 24px;
    border: 1px solid var(--line);
    border-radius: 24px;
    background: rgba(8, 18, 28, 0.72);
  }

  .compact {
    display: flex;
    gap: 18px;
    align-items: end;
    justify-content: space-between;
    flex-wrap: wrap;
  }

  .toolbar {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }

  .list-controls {
    display: flex;
    gap: 12px;
    align-items: end;
    flex-wrap: wrap;
  }

  .inline-field {
    min-width: 120px;
  }

  .grow {
    flex: 1 1 220px;
  }

  .derived-grid {
    display: grid;
    gap: 14px;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  :global(.derived-card) {
    display: grid;
    gap: 14px;
    padding: 18px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.04);
  }

  .derived-head {
    display: grid;
    gap: 6px;
  }

  .derived-head span {
    color: var(--muted);
    font-size: 0.85rem;
  }

  .derived-summary {
    display: grid;
    gap: 8px;
    color: var(--accent-soft);
    font-size: 0.92rem;
  }

  .pagination-bar {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
  }
</style>
