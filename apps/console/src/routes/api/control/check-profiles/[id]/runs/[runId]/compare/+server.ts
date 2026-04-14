import type { RequestHandler } from './$types';
import {
  getControlPlaneClient,
  proxyControlResponse,
  readRunComparisonQuery
} from '$lib/server/control-plane';

export const GET: RequestHandler = async ({ params, platform, url }) =>
  proxyControlResponse(
    getControlPlaneClient(platform).app.checkProfiles.runs.compare({
      params: { id: params.id, runId: params.runId },
      query: readRunComparisonQuery(url.search)
    })
  );
