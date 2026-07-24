import type { RequestHandler } from './$types';
import { proxyBrowserAuditArtifactDownload } from '$lib/server/control-plane';

export const GET: RequestHandler = async ({ params, platform }) =>
  proxyBrowserAuditArtifactDownload(platform, params.id, params.artifactId);
