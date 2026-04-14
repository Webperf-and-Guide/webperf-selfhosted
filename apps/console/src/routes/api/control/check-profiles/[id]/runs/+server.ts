import type { RequestHandler } from './$types';
import {
  getControlPlaneClient,
  getRequesterIp,
  proxyControlResponse
} from '$lib/server/control-plane';

export const GET: RequestHandler = async ({ params, platform }) =>
  proxyControlResponse(getControlPlaneClient(platform).listCheckProfileRuns(params.id));

export const POST: RequestHandler = async ({ request, params, platform }) =>
  proxyControlResponse(
    getControlPlaneClient(platform).runCheckProfile(params.id, {
      requesterIp: getRequesterIp(request)
    })
  );
