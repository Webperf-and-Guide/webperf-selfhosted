import type { MetricGridItem } from '@webperf/ui/components/operator/types';

type ReportsAccessors = {
  getSavedChecksEnabled: () => boolean;
};

export class ReportsController {
  state = $state({
    workspaceTab: 'browser' as 'browser' | 'endpoints'
  });

  constructor(private readonly accessors: ReportsAccessors) {}

  get savedChecksEnabled() {
    return this.accessors.getSavedChecksEnabled();
  }

  get summaryItems(): MetricGridItem[] {
    return [
      {
        id: 'comparisons',
        label: 'Comparisons',
        value: 'Latest vs previous and baseline',
        detail: 'Keep regressions, improvements, and unchanged routes isolated from configuration.'
      },
      {
        id: 'exports',
        label: 'Exports',
        value: 'JSON and CSV',
        detail: 'Send deterministic report payloads to CI artifacts, handoffs, or incident notes.'
      },
      {
        id: 'browser',
        label: 'Derived resources',
        value: 'Report browser',
        detail: 'Browse persisted comparisons and exports without leaving the operator workspace.'
      }
    ];
  }
}

export const createReportsController = (accessors: ReportsAccessors) =>
  new ReportsController(accessors);
