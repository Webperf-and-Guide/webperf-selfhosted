import type { UpdateCheckProfileInput } from '@webperf/contracts';
import type { RequestHandler } from './$types';
import { getControlPlaneClient, proxyControlResponse } from '$lib/server/control-plane';

export const GET: RequestHandler = async ({ params, platform }) =>
  proxyControlResponse(getControlPlaneClient(platform).app.checkProfiles.get({ params: { id: params.id } }));

export const PUT: RequestHandler = async ({ request, params, platform }) =>
  proxyControlResponse(
    getControlPlaneClient(platform).app.checkProfiles.update({
      params: { id: params.id },
      body: await request.json() as UpdateCheckProfileInput
    })
  );

export const DELETE: RequestHandler = async ({ params, platform }) =>
  proxyControlResponse(getControlPlaneClient(platform).app.checkProfiles.delete({ params: { id: params.id } }));
