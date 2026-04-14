import type { RequestHandler } from './$types';
import { getControlPlaneClient, proxyControlStream } from '$lib/server/control-plane';

export const GET: RequestHandler = async ({ params, platform }) =>
  proxyControlStream(() =>
    getControlPlaneClient(platform).ops.jobs.stream({ params: { jobId: params.id } })
  );
