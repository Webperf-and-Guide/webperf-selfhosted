import type { RequestHandler } from './$types';
import {
  getControlPlaneClient,
  getRequesterIp,
  proxyControlResponse
} from '$lib/server/control-plane';
import { readListQuery } from '$lib/server/list-query';

export const GET: RequestHandler = async ({ platform, url }) =>
  proxyControlResponse(getControlPlaneClient(platform).listJobs(readListQuery(url)));

export const POST: RequestHandler = async ({ request, platform }) =>
  proxyControlResponse(
    getControlPlaneClient(platform).createJob(await request.json(), {
      requesterIp: getRequesterIp(request)
    })
  );
