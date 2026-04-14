import type { SetCheckProfileBaselineInput } from '@webperf/contracts';
import type { RequestHandler } from './$types';
import { getControlPlaneClient, proxyControlResponse } from '$lib/server/control-plane';

export const GET: RequestHandler = async ({ params, platform }) =>
  proxyControlResponse(
    getControlPlaneClient(platform).app.checkProfiles.baseline.get({ params: { id: params.id } })
  );

export const PUT: RequestHandler = async ({ request, params, platform }) =>
  proxyControlResponse(
    getControlPlaneClient(platform).app.checkProfiles.baseline.set({
      params: { id: params.id },
      body: await request.json() as SetCheckProfileBaselineInput
    })
  );

export const DELETE: RequestHandler = async ({ params, platform }) =>
  proxyControlResponse(
    getControlPlaneClient(platform).app.checkProfiles.baseline.clear({ params: { id: params.id } })
  );
