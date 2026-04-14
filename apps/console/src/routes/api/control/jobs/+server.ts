import type { CreateLatencyJobInput } from '@webperf/contracts';
import type { RequestHandler } from './$types';
import {
  getControlPlaneClient,
  getRequesterIp,
  proxyControlResponse,
  toListInput
} from '$lib/server/control-plane';
import { readListQuery } from '$lib/server/list-query';

export const GET: RequestHandler = async ({ platform, url }) =>
  proxyControlResponse(getControlPlaneClient(platform).ops.jobs.list(toListInput(readListQuery(url))));

export const POST: RequestHandler = async ({ request, platform }) =>
  proxyControlResponse(
    getControlPlaneClient(platform, getRequesterIp(request)).ops.jobs.create(
      await request.json() as CreateLatencyJobInput
    ),
    201
  );
