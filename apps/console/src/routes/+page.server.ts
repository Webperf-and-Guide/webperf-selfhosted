import type { PageServerLoad } from './$types';
import { parseWebEnv } from '@webperf/env-schema/public';
import type {
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

type SavedChecksData = {
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

type LoaderFetch = typeof fetch;

export const load: PageServerLoad = async ({ fetch, platform }) => {
  const runtime = parseWebEnv({
    CONTROL_BASE_URL: platform?.env?.CONTROL_BASE_URL ?? privateEnv.CONTROL_BASE_URL,
    EDGE_CONTROL_BASE_URL: platform?.env?.EDGE_CONTROL_BASE_URL ?? privateEnv.EDGE_CONTROL_BASE_URL,
    CONTROL_BINDING_MODE: platform?.env?.CONTROL_BINDING_MODE ?? privateEnv.CONTROL_BINDING_MODE,
    DEPLOY_TARGET: platform?.env?.DEPLOY_TARGET ?? privateEnv.DEPLOY_TARGET,
    TURNSTILE_SITE_KEY: platform?.env?.TURNSTILE_SITE_KEY ?? privateEnv.TURNSTILE_SITE_KEY
  });

  const regionsResponse = await fetch('/api/control/regions');
  const regionsPayload = (await regionsResponse.json()) as RegionsResponse;
  const savedChecks = await loadSavedChecks(fetch);

  return {
    regions: regionsPayload.regions,
    turnstileSiteKey: runtime.TURNSTILE_SITE_KEY ?? null,
    savedChecks
  };
};

const loadSavedChecks = async (fetchFn: LoaderFetch) => {
  const checkProfilesPayload = await fetchOptionalJson<CheckProfileListResponse>(
    fetchFn,
    '/api/control/check-profiles?pageSize=200'
  );

  if (!checkProfilesPayload) {
    return null satisfies SavedChecksData | null;
  }

  const [propertiesPayload, routeSetsPayload, regionPacksPayload, profileMeta] = await Promise.all([
    fetchOptionalJson<PropertyListResponse>(fetchFn, '/api/control/properties?pageSize=200'),
    fetchOptionalJson<RouteSetListResponse>(fetchFn, '/api/control/route-sets?pageSize=200'),
    fetchOptionalJson<RegionPackListResponse>(fetchFn, '/api/control/region-packs?pageSize=200'),
    Promise.all(
      checkProfilesPayload.checkProfiles.map(async (profile) => {
        const [runsPayload, latestComparison, baselineComparison, report] = await Promise.all([
          fetchOptionalJson<CheckProfileRunListResponse>(
            fetchFn,
            `/api/control/check-profiles/${profile.id}/runs?pageSize=10`
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

        const recentRunIds = runsPayload?.runs.slice(0, 3).map((run) => run.id) ?? [];
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
