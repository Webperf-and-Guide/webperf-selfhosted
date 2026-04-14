import type { UpdateRegionPackInput } from '@webperf/contracts';
import type { RequestHandler } from './$types';
import { getControlPlaneClient, proxyControlResponse } from '$lib/server/control-plane';

export const GET: RequestHandler = async ({ params, platform }) =>
  proxyControlResponse(getControlPlaneClient(platform).app.regionPacks.get({ params: { id: params.id } }));

export const PUT: RequestHandler = async ({ request, params, platform }) =>
  proxyControlResponse(
    getControlPlaneClient(platform).app.regionPacks.update({
      params: { id: params.id },
      body: await request.json() as UpdateRegionPackInput
    })
  );

export const DELETE: RequestHandler = async ({ params, platform }) =>
  proxyControlResponse(getControlPlaneClient(platform).app.regionPacks.delete({ params: { id: params.id } }));
