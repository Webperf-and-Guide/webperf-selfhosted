import type { UpdateRouteSetInput } from '@webperf/contracts';
import type { RequestHandler } from './$types';
import { getControlPlaneClient, proxyControlResponse } from '$lib/server/control-plane';

export const GET: RequestHandler = async ({ params, platform }) =>
  proxyControlResponse(getControlPlaneClient(platform).app.routeSets.get({ params: { id: params.id } }));

export const PUT: RequestHandler = async ({ request, params, platform }) =>
  proxyControlResponse(
    getControlPlaneClient(platform).app.routeSets.update({
      params: { id: params.id },
      body: await request.json() as UpdateRouteSetInput
    })
  );

export const DELETE: RequestHandler = async ({ params, platform }) =>
  proxyControlResponse(getControlPlaneClient(platform).app.routeSets.delete({ params: { id: params.id } }));
