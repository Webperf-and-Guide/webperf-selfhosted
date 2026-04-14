import type { CreateRegionPackInput } from '@webperf/contracts';
import type { RequestHandler } from './$types';
import { getControlPlaneClient, proxyControlResponse, toListInput } from '$lib/server/control-plane';
import { readListQuery } from '$lib/server/list-query';

export const GET: RequestHandler = async ({ platform, url }) =>
  proxyControlResponse(getControlPlaneClient(platform).app.regionPacks.list(toListInput(readListQuery(url))));

export const POST: RequestHandler = async ({ request, platform }) =>
  proxyControlResponse(
    getControlPlaneClient(platform).app.regionPacks.create(await request.json() as CreateRegionPackInput),
    201
  );
