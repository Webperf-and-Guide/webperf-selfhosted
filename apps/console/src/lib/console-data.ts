import type {
  BrowserAuditListResponse,
  CheckProfileComparisonResponse,
  CheckProfileLatestComparisonResponse,
  CheckProfileReportResponse,
  CheckProfileRunDetailResponse,
  CheckProfileRunListResponse,
  PropertyListResponse,
  RegionAvailability,
  RegionPackListResponse,
  RouteSetListResponse,
  CheckProfileListResponse
} from '@webperf/contracts';

export type SavedChecksData = {
  properties: PropertyListResponse['properties'];
  routeSets: RouteSetListResponse['routeSets'];
  regionPacks: RegionPackListResponse['regionPacks'];
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
  regions: RegionAvailability[];
  turnstileSiteKey: string | null;
  capabilities: {
    browserAuditDirectRun: boolean;
  };
  browserAudits: BrowserAuditListResponse['browserAudits'];
  savedChecks: SavedChecksData | null;
};

export type ConsoleWorkspaceMode = 'overview' | 'resources' | 'checks' | 'reports' | 'regions';
