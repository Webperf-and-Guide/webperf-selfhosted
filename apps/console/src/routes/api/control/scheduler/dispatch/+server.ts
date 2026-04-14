import type { RequestHandler } from './$types';
import { getControlPlaneClient, proxyControlResponse } from '$lib/server/control-plane';

export const POST: RequestHandler = async ({ platform, url }) =>
  proxyControlResponse(
    getControlPlaneClient(platform).ops.scheduler.dispatch({ now: url.searchParams.get('now') ?? null })
  );
