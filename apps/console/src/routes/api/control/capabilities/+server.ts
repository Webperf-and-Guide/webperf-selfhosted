import type { RequestHandler } from './$types';
import { getControlPlaneClient, proxyControlResponse } from '$lib/server/control-plane';

export const GET: RequestHandler = async ({ platform }) =>
  proxyControlResponse(getControlPlaneClient(platform).public.capabilities.get());
