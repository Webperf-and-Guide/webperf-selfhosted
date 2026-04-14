import type { ReportExportFormat } from '@webperf/contracts';
import type { RequestHandler } from './$types';
import { getControlPlaneClient, proxyControlDownload } from '$lib/server/control-plane';

export const GET: RequestHandler = async ({ params, platform, url }) =>
  proxyControlDownload(
    getControlPlaneClient(platform).app.checkProfiles.reportExport({
      params: { id: params.id },
      body: { format: (url.searchParams.get('format') ?? 'json') as ReportExportFormat }
    })
  );
