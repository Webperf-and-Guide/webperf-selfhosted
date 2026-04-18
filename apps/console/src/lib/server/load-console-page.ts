import { parseWebEnv } from '@webperf/config/public';
import type {
  BrowserAuditListResponse,
  CheckProfileComparisonResponse,
  CheckProfileLatestComparisonResponse,
  CheckProfileListResponse,
  CheckProfileReportResponse,
  CheckProfileRunDetailResponse,
  CheckProfileRunListResponse,
  PropertyListResponse,
  RegionPackListResponse,
  RegionsResponse,
  RouteSetListResponse
} from '@webperf/contracts';
import { env as privateEnv } from '$env/dynamic/private';
import type { ConsolePageData, SavedChecksData } from '$lib/console-data';
import { CONSOLE_COLLECTION_PAGE_SIZE, CONSOLE_RECENT_RUN_COUNT, CONSOLE_RUN_PAGE_SIZE } from '$lib/console-workspace/formatters';

type LoaderFetch = typeof fetch;
type Platform = App.Platform | undefined;

export const loadConsolePage = async ({
  fetch,
  platform
}: {
  fetch: LoaderFetch;
  platform: Platform;
}): Promise<ConsolePageData> => {
  const runtime = parseWebEnv({
    CONTROL_BASE_URL: platform?.env?.CONTROL_BASE_URL ?? privateEnv.CONTROL_BASE_URL,
    DEPLOY_TARGET: platform?.env?.DEPLOY_TARGET ?? privateEnv.DEPLOY_TARGET,
    TURNSTILE_SITE_KEY: platform?.env?.TURNSTILE_SITE_KEY ?? privateEnv.TURNSTILE_SITE_KEY
  });

  const regionsPayload = await fetchOptionalJson<RegionsResponse>(fetch, '/api/control/regions');
  const capabilitiesPayload = await fetchOptionalJson<{
    features?: {
      browserAuditDirectRun?: boolean;
    };
  }>(fetch, '/api/control/capabilities');
  const browserAuditsPayload = await fetchOptionalJson<BrowserAuditListResponse>(
    fetch,
    `/api/control/browser-audits?pageSize=${CONSOLE_COLLECTION_PAGE_SIZE}`
  );
  const savedChecks = await loadSavedChecks(fetch);

  return {
    regions: regionsPayload?.regions ?? [],
    turnstileSiteKey: runtime.TURNSTILE_SITE_KEY ?? null,
    capabilities: {
      browserAuditDirectRun: Boolean(capabilitiesPayload?.features?.browserAuditDirectRun)
    },
    browserAudits: browserAuditsPayload?.browserAudits ?? [],
    savedChecks
  };
};

const loadSavedChecks = async (fetchFn: LoaderFetch) => {
  const checkProfilesPayload = await fetchOptionalJson<CheckProfileListResponse>(
    fetchFn,
    `/api/control/check-profiles?pageSize=${CONSOLE_COLLECTION_PAGE_SIZE}`
  );

  if (!checkProfilesPayload) {
    return null satisfies SavedChecksData | null;
  }

  const [propertiesPayload, routeSetsPayload, regionPacksPayload, profileMeta] = await Promise.all([
    fetchOptionalJson<PropertyListResponse>(fetchFn, `/api/control/properties?pageSize=${CONSOLE_COLLECTION_PAGE_SIZE}`),
    fetchOptionalJson<RouteSetListResponse>(fetchFn, `/api/control/route-sets?pageSize=${CONSOLE_COLLECTION_PAGE_SIZE}`),
    fetchOptionalJson<RegionPackListResponse>(fetchFn, `/api/control/region-packs?pageSize=${CONSOLE_COLLECTION_PAGE_SIZE}`),
    Promise.all(
      checkProfilesPayload.checkProfiles.map(async (profile) => {
        const [runsPayload, latestComparison, baselineComparison, report] = await Promise.all([
          fetchOptionalJson<CheckProfileRunListResponse>(
            fetchFn,
            `/api/control/check-profiles/${profile.id}/runs?pageSize=${CONSOLE_RUN_PAGE_SIZE}`
          ),
          fetchOptionalJson<CheckProfileLatestComparisonResponse>(
            fetchFn,
            `/api/control/check-profiles/${profile.id}/compare/latest`
          ),
          fetchOptionalJson<CheckProfileComparisonResponse>(
            fetchFn,
            `/api/control/check-profiles/${profile.id}/compare/baseline`
          ),
          fetchOptionalJson<CheckProfileReportResponse>(fetchFn, `/api/control/check-profiles/${profile.id}/report`)
        ]);

        const recentRunIds = runsPayload?.runs.slice(0, CONSOLE_RECENT_RUN_COUNT).map((run) => run.id) ?? [];
        const recentRunDetails = (
          await Promise.all(
            recentRunIds.map((runId) =>
              fetchOptionalJson<CheckProfileRunDetailResponse>(
                fetchFn,
                `/api/control/check-profiles/${profile.id}/runs/${runId}`
              )
            )
          )
        ).filter((detail): detail is CheckProfileRunDetailResponse => detail !== null);

        return {
          profileId: profile.id,
          runs: runsPayload?.runs ?? [],
          latestComparison,
          baselineComparison,
          recentRunDetails,
          report
        };
      })
    )
  ]);

  return {
    properties: propertiesPayload?.properties ?? [],
    routeSets: routeSetsPayload?.routeSets ?? [],
    regionPacks: regionPacksPayload?.regionPacks ?? [],
    checkProfiles: checkProfilesPayload.checkProfiles,
    profileMeta
  } satisfies SavedChecksData;
};

const fetchOptionalJson = async <T>(fetchFn: LoaderFetch, path: string): Promise<T | null> => {
  try {
    const response = await fetchFn(path);

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
};
