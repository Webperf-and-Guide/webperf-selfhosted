import type { UpdatePropertyInput } from '@webperf/contracts';
import type { RequestHandler } from './$types';
import { getControlPlaneClient, proxyControlResponse } from '$lib/server/control-plane';

export const GET: RequestHandler = async ({ params, platform }) =>
  proxyControlResponse(getControlPlaneClient(platform).app.properties.get({ params: { id: params.id } }));

export const PUT: RequestHandler = async ({ request, params, platform }) =>
  proxyControlResponse(
    getControlPlaneClient(platform).app.properties.update({
      params: { id: params.id },
      body: await request.json() as UpdatePropertyInput
    })
  );

export const DELETE: RequestHandler = async ({ params, platform }) =>
  proxyControlResponse(getControlPlaneClient(platform).app.properties.delete({ params: { id: params.id } }));
