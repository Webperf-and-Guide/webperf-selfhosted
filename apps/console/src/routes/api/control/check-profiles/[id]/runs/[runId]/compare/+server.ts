import type { RequestHandler } from './$types';
import { getControlPlaneClient, proxyControlResponse } from '$lib/server/control-plane';

export const GET: RequestHandler = async ({ params, platform, url }) =>
  proxyControlResponse(
    getControlPlaneClient(platform).getCheckProfileRunComparison(params.id, params.runId, url.search)
  );
