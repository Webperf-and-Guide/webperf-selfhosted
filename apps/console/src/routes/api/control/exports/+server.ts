import type { RequestHandler } from './$types';
import { getControlPlaneClient, proxyControlResponse, toListInput } from '$lib/server/control-plane';
import { readListQuery } from '$lib/server/list-query';

export const GET: RequestHandler = async ({ platform, url }) =>
  proxyControlResponse(getControlPlaneClient(platform).app.exports.list(toListInput(readListQuery(url))));
