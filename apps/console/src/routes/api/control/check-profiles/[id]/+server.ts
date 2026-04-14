import type { RequestHandler } from './$types';
import { getControlPlaneClient, proxyControlResponse } from '$lib/server/control-plane';

export const GET: RequestHandler = async ({ params, platform }) =>
  proxyControlResponse(getControlPlaneClient(platform).getCheckProfile(params.id));

export const PUT: RequestHandler = async ({ request, params, platform }) =>
  proxyControlResponse(getControlPlaneClient(platform).updateCheckProfile(params.id, await request.json()));

export const DELETE: RequestHandler = async ({ params, platform }) =>
  proxyControlResponse(getControlPlaneClient(platform).deleteCheckProfile(params.id));
