import type { RequestHandler } from './$types';
import { getControlPlaneClient, proxyControlResponse, toListInput } from '$lib/server/control-plane';
import { readListQuery } from '$lib/server/list-query';

export const GET: RequestHandler = async ({ platform, url }) =>
  proxyControlResponse(getControlPlaneClient(platform).app.browserAudits.list(toListInput(readListQuery(url))));

export const POST: RequestHandler = async ({ request, platform }) =>
  proxyControlResponse(getControlPlaneClient(platform).app.browserAudits.create(await request.json()), 201);
