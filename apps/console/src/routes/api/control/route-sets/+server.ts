import type { RequestHandler } from './$types';
import { getControlPlaneClient, proxyControlResponse } from '$lib/server/control-plane';
import { readListQuery } from '$lib/server/list-query';

export const GET: RequestHandler = async ({ platform, url }) =>
  proxyControlResponse(getControlPlaneClient(platform).listRouteSets(readListQuery(url)));

export const POST: RequestHandler = async ({ request, platform }) =>
  proxyControlResponse(getControlPlaneClient(platform).createRouteSet(await request.json()));
