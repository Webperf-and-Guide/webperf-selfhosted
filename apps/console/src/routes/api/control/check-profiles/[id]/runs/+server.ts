import type { RequestHandler } from './$types';
import {
  getControlPlaneClient,
  getRequesterIp,
  proxyControlResponse
} from '$lib/server/control-plane';
import { readListQuery } from '$lib/server/list-query';

export const GET: RequestHandler = async ({ params, platform, url }) =>
  proxyControlResponse(
    getControlPlaneClient(platform).app.checkProfiles.runs.list({
      params: { id: params.id },
      query: readListQuery(url)
    })
  );

export const POST: RequestHandler = async ({ request, params, platform }) =>
  proxyControlResponse(
    getControlPlaneClient(platform, getRequesterIp(request)).app.checkProfiles.runs.create({
      params: { id: params.id }
    }),
    201
  );
