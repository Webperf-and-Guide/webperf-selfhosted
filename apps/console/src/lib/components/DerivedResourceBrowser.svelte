<script lang="ts">
  import { browser } from '$app/environment';
  import { createQuery } from '@tanstack/svelte-query';
  import { DerivedResourcePanel } from '@webperf/ui/components/operator/derived-resource-panel';
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
    pageSize: 8,
    totalCount: 0,
    nextPageToken: null,
    filter: null
  };

  let kind = $state<ResourceKind>('comparisons');
  let filterDraft = $state('');
  let filter = $state('');
  let pageSize = $state(8);
  let pageToken = $state<string | null>(null);
  let previousTokens = $state<string[]>([]);

  const resourceTabs = [
    { value: 'comparisons', label: 'comparisons' },
    { value: 'exports', label: 'exports' },
    { value: 'analyses', label: 'analyses' }
  ] satisfies { value: ResourceKind; label: string }[];

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
  const panelItems = $derived.by(() =>
    items.map((item: ResourceItem) => ({
      id: item.id,
      createdAtLabel: new Date(item.createdAt).toLocaleString(),
      summary: summarizeItem(item)
    }))
  );

  const resetPaging = () => {
    pageToken = null;
    previousTokens = [];
  };

  const applyFilter = () => {
    filter = filterDraft.trim();
    resetPaging();
  };

  const changeKind = (nextKind: string) => {
    kind = nextKind as ResourceKind;
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

<DerivedResourcePanel
  appliedFilter={pageInfo.filter}
  bind:filterValue={filterDraft}
  bind:kind
  bind:pageSize={pageSize}
  canGoNext={Boolean(pageInfo.nextPageToken)}
  canGoPrevious={previousTokens.length > 0}
  description="Scan recent comparisons, exports, and analyses from one dense operator feed."
  errorMessage={resourceQuery.isError ? resourceQuery.error?.message ?? `Failed to load ${kind}.` : null}
  isPending={resourceQuery.isPending}
  items={panelItems}
  onApplyFilter={applyFilter}
  onKindChange={changeKind}
  onNext={goToNextPage}
  onPageSizeChange={() => resetPaging()}
  onPrevious={goToPreviousPage}
  tabs={resourceTabs}
  title="Derived reports"
  totalCount={pageInfo.totalCount}
/>
