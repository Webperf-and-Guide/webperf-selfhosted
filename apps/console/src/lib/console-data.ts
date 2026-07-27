import type {
  BrowserAuditListResponse,
  CheckProfileComparisonResponse,
  CheckProfileLatestComparisonResponse,
  CheckProfileReportResponse,
  CheckProfileRunDetailResponse,
  CheckProfileRunListResponse,
  PropertyListResponse,
  RouteSetListResponse,
  CheckProfileListResponse,
  RuntimeLocationReport
} from '@webperf/contracts';

export type SavedChecksData = {
  properties: PropertyListResponse['properties'];
  routeSets: RouteSetListResponse['routeSets'];
  checkProfiles: CheckProfileListResponse['checkProfiles'];
  profileMeta: Array<{
    profileId: string;
    runs: CheckProfileRunListResponse['runs'];
    latestComparison: CheckProfileLatestComparisonResponse | null;
    baselineComparison: CheckProfileComparisonResponse | null;
    recentRunDetails: CheckProfileRunDetailResponse[];
    report: CheckProfileReportResponse | null;
  }>;
};

export type ConsolePageData = {
  // Phase 1 of issue #14: the 41-city availability catalog became a single
  // runtime location for one standalone deployment.
  runtimeLocation: RuntimeLocationReport;
  capabilities: {
    browserAuditDirectRun: boolean;
  };
  browserAudits: BrowserAuditListResponse['browserAudits'];
  savedChecks: SavedChecksData | null;
};

export type ConsoleWorkspaceMode = 'overview' | 'resources' | 'checks' | 'reports' | 'regions';
