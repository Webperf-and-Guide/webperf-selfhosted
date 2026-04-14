import type { CreatePropertyInput } from '@webperf/contracts';
import type { RequestHandler } from './$types';
import { getControlPlaneClient, proxyControlResponse, toListInput } from '$lib/server/control-plane';
import { readListQuery } from '$lib/server/list-query';

export const GET: RequestHandler = async ({ platform, url }) =>
  proxyControlResponse(getControlPlaneClient(platform).app.properties.list(toListInput(readListQuery(url))));

export const POST: RequestHandler = async ({ request, platform }) =>
  proxyControlResponse(
    getControlPlaneClient(platform).app.properties.create(await request.json() as CreatePropertyInput),
    201
  );
