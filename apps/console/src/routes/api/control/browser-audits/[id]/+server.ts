import type { RequestHandler } from './$types';
import { getControlPlaneClient, proxyControlResponse } from '$lib/server/control-plane';

export const GET: RequestHandler = async ({ params, platform }) =>
  proxyControlResponse(
    getControlPlaneClient(platform).app.browserAudits.get({
      params: { auditId: params.id }
    })
  );
