import type { RequestHandler } from './$types';
import { getControlPlaneClient, proxyControlResponse } from '$lib/server/control-plane';

export const GET: RequestHandler = async ({ params, platform }) =>
  proxyControlResponse(
    getControlPlaneClient(platform).app.checkProfiles.compareBaseline({ params: { id: params.id } })
  );
