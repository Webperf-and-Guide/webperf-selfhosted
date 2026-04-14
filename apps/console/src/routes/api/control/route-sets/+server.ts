import type { CreateRouteSetInput } from '@webperf/contracts';
import type { RequestHandler } from './$types';
import { getControlPlaneClient, proxyControlResponse, toListInput } from '$lib/server/control-plane';
import { readListQuery } from '$lib/server/list-query';

export const GET: RequestHandler = async ({ platform, url }) =>
  proxyControlResponse(getControlPlaneClient(platform).app.routeSets.list(toListInput(readListQuery(url))));

export const POST: RequestHandler = async ({ request, platform }) =>
  proxyControlResponse(
    getControlPlaneClient(platform).app.routeSets.create(await request.json() as CreateRouteSetInput),
    201
  );
