import { ORPCError, createORPCClient, safe } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { appContract, opsContract } from '@webperf/contracts';
import { parseWebEnv } from '@webperf/env-schema/public';
import { env as privateEnv } from '$env/dynamic/private';

type Platform = App.Platform | undefined;

type RequesterContext = {
  requesterIp?: string | null;
};

export type ControlListQuery = {
  pageSize?: number;
  pageToken?: string | null;
  filter?: string | null;
};

type AppRpcClient = ContractRouterClient<typeof appContract>;
type OpsRpcClient = ContractRouterClient<typeof opsContract>;

type ControlPlaneClient = {
  getHealth(): Promise<Response>;
  listRegions(): Promise<Response>;
  listJobs(query?: ControlListQuery): Promise<Response>;
  createJob(input: unknown, ctx?: RequesterContext): Promise<Response>;
  getJob(jobId: string): Promise<Response>;
  streamJob(jobId: string): Promise<ReadableStream<Uint8Array>>;
  listProperties(query?: ControlListQuery): Promise<Response>;
  createProperty(input: unknown): Promise<Response>;
  getProperty(id: string): Promise<Response>;
  updateProperty(id: string, input: unknown): Promise<Response>;
  deleteProperty(id: string): Promise<Response>;
  listRouteSets(query?: ControlListQuery): Promise<Response>;
  createRouteSet(input: unknown): Promise<Response>;
  getRouteSet(id: string): Promise<Response>;
  updateRouteSet(id: string, input: unknown): Promise<Response>;
  deleteRouteSet(id: string): Promise<Response>;
  listRegionPacks(query?: ControlListQuery): Promise<Response>;
  createRegionPack(input: unknown): Promise<Response>;
  getRegionPack(id: string): Promise<Response>;
  updateRegionPack(id: string, input: unknown): Promise<Response>;
  deleteRegionPack(id: string): Promise<Response>;
  listCheckProfiles(query?: ControlListQuery): Promise<Response>;
  createCheckProfile(input: unknown): Promise<Response>;
  getCheckProfile(id: string): Promise<Response>;
  updateCheckProfile(id: string, input: unknown): Promise<Response>;
  deleteCheckProfile(id: string): Promise<Response>;
  getCheckProfileBaseline(id: string): Promise<Response>;
  setCheckProfileBaseline(id: string, input: unknown): Promise<Response>;
  clearCheckProfileBaseline(id: string): Promise<Response>;
  listCheckProfileRuns(id: string, query?: ControlListQuery): Promise<Response>;
  runCheckProfile(id: string, ctx?: RequesterContext): Promise<Response>;
  getCheckProfileRun(id: string, runId: string): Promise<Response>;
  getCheckProfileRunComparison(id: string, runId: string, query?: string): Promise<Response>;
  getLatestCheckProfileComparison(id: string): Promise<Response>;
  getBaselineCheckProfileComparison(id: string): Promise<Response>;
  getCheckProfileReport(id: string): Promise<Response>;
  exportCheckProfileReport(id: string, format: string): Promise<Response>;
  listComparisons(query?: ControlListQuery): Promise<Response>;
  listExports(query?: ControlListQuery): Promise<Response>;
  listAnalyses(query?: ControlListQuery): Promise<Response>;
  dispatchScheduler(now?: string | null): Promise<Response>;
};

const createJobSseStream = (getSnapshot: () => Promise<{
  type: 'job.snapshot';
  job: {
    summary: {
      inflight: number;
    };
  };
}>) => {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const pump = async () => {
        for (let i = 0; i < 60; i += 1) {
          const snapshot = await getSnapshot();
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`));

          if (snapshot.job.summary.inflight === 0) {
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        controller.close();
      };

      void pump();
    }
  });
};

const proxyResponse = (response: Response) => {
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.delete('transfer-encoding');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};

const resolveRuntime = (platform: Platform) =>
  parseWebEnv({
    CONTROL_BASE_URL: platform?.env?.CONTROL_BASE_URL ?? privateEnv.CONTROL_BASE_URL,
    EDGE_CONTROL_BASE_URL: platform?.env?.EDGE_CONTROL_BASE_URL ?? privateEnv.EDGE_CONTROL_BASE_URL,
    CONTROL_BINDING_MODE: platform?.env?.CONTROL_BINDING_MODE ?? privateEnv.CONTROL_BINDING_MODE,
    DEPLOY_TARGET: platform?.env?.DEPLOY_TARGET ?? privateEnv.DEPLOY_TARGET,
    TURNSTILE_SITE_KEY: platform?.env?.TURNSTILE_SITE_KEY ?? privateEnv.TURNSTILE_SITE_KEY
  });

const buildHeaders = (requesterIp?: string | null, initial?: HeadersInit) => {
  const headers = new Headers(initial);

  if (requesterIp) {
    headers.set('cf-connecting-ip', requesterIp);
    headers.set('x-forwarded-for', requesterIp);
    headers.set('x-real-ip', requesterIp);
  }

  return headers;
};

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8'
    }
  });

const toErrorResponse = (error: unknown) => {
  const normalized = error instanceof ORPCError ? error : new ORPCError('INTERNAL_SERVER_ERROR', {
    message: error instanceof Error ? error.message : 'Unexpected control-plane error'
  });

  return jsonResponse(
    {
      error: normalized.message,
      code: normalized.code,
      data: normalized.data ?? null
    },
    normalized.status
  );
};

const toListInput = (query?: ControlListQuery) =>
  query ? ({ query } as const) : ({} as const);

const createFallbackAppRpcClient = (
  runtime: ReturnType<typeof resolveRuntime>,
  requesterIp?: string | null
): AppRpcClient =>
  createORPCClient(
    new RPCLink({
      url: new URL('/rpc/app', runtime.CONTROL_BASE_URL).toString(),
      fetch: (input, init) => {
        const request = new Request(input, init);
        const headers = buildHeaders(requesterIp, request.headers);
        return fetch(new Request(request, { headers, redirect: 'manual' }));
      }
    })
  ) as AppRpcClient;

const createFallbackOpsRpcClient = (
  runtime: ReturnType<typeof resolveRuntime>,
  requesterIp?: string | null
): OpsRpcClient =>
  createORPCClient(
    new RPCLink({
      url: new URL('/rpc/ops', runtime.CONTROL_BASE_URL).toString(),
      fetch: (input, init) => {
        const request = new Request(input, init);
        const headers = buildHeaders(requesterIp, request.headers);
        return fetch(new Request(request, { headers, redirect: 'manual' }));
      }
    })
  ) as OpsRpcClient;

const createFallbackClient = (
  runtime: ReturnType<typeof resolveRuntime>
): ControlPlaneClient => {
  const execute = async <T>(promise: Promise<T>, successStatus = 200) => {
    const [error, data, isDefined, isSuccess] = await safe(promise);

    if (isSuccess) {
      return jsonResponse(data, successStatus);
    }

    return toErrorResponse(isDefined ? error : new ORPCError('INTERNAL_SERVER_ERROR', {
      message: error instanceof Error ? error.message : 'Unexpected control-plane error'
    }));
  };

  const request = async (path: string, init?: { method?: string; body?: unknown; requesterIp?: string | null }) => {
    const headers = buildHeaders(init?.requesterIp);
    let body: string | undefined;

    if (init?.body !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(init.body);
    }

    return fetch(new URL(path, runtime.CONTROL_BASE_URL).toString(), {
      method: init?.method ?? 'GET',
      headers,
      body,
      redirect: 'manual'
    });
  };

  const parseCompareQuery = (_id: string, _runId: string, query?: string) => {
    const search = new URLSearchParams(query ?? '');

    return {
      against: search.get('against') as 'baseline' | 'previous' | 'custom' | null | undefined,
      againstRunId: search.get('againstRunId') ?? undefined
    };
  };

  return {
    getHealth: () => execute(createFallbackOpsRpcClient(runtime).system.health()),
    listRegions: () => execute(createFallbackAppRpcClient(runtime).system.regions()),
    listJobs: (query) => execute(createFallbackOpsRpcClient(runtime).jobs.list(toListInput(query) as never)),
    createJob: (input, ctx) => execute(createFallbackOpsRpcClient(runtime, ctx?.requesterIp).jobs.create(input as never), 201),
    getJob: (jobId) => execute(createFallbackOpsRpcClient(runtime).jobs.get({ params: { jobId } } as never)),
    async streamJob(jobId) {
      return createJobSseStream(() =>
        createFallbackOpsRpcClient(runtime).jobs.stream({ params: { jobId } } as never)
      );
    },
    listProperties: (query) => execute(createFallbackAppRpcClient(runtime).properties.list(toListInput(query) as never)),
    createProperty: (input) => execute(createFallbackAppRpcClient(runtime).properties.create(input as never), 201),
    getProperty: (id) => execute(createFallbackAppRpcClient(runtime).properties.get({ params: { id } } as never)),
    updateProperty: (id, input) => execute(createFallbackAppRpcClient(runtime).properties.update({ params: { id }, body: input } as never)),
    deleteProperty: (id) => execute(createFallbackAppRpcClient(runtime).properties.delete({ params: { id } } as never)),
    listRouteSets: (query) => execute(createFallbackAppRpcClient(runtime).routeSets.list(toListInput(query) as never)),
    createRouteSet: (input) => execute(createFallbackAppRpcClient(runtime).routeSets.create(input as never), 201),
    getRouteSet: (id) => execute(createFallbackAppRpcClient(runtime).routeSets.get({ params: { id } } as never)),
    updateRouteSet: (id, input) => execute(createFallbackAppRpcClient(runtime).routeSets.update({ params: { id }, body: input } as never)),
    deleteRouteSet: (id) => execute(createFallbackAppRpcClient(runtime).routeSets.delete({ params: { id } } as never)),
    listRegionPacks: (query) => execute(createFallbackAppRpcClient(runtime).regionPacks.list(toListInput(query) as never)),
    createRegionPack: (input) => execute(createFallbackAppRpcClient(runtime).regionPacks.create(input as never), 201),
    getRegionPack: (id) => execute(createFallbackAppRpcClient(runtime).regionPacks.get({ params: { id } } as never)),
    updateRegionPack: (id, input) => execute(createFallbackAppRpcClient(runtime).regionPacks.update({ params: { id }, body: input } as never)),
    deleteRegionPack: (id) => execute(createFallbackAppRpcClient(runtime).regionPacks.delete({ params: { id } } as never)),
    listCheckProfiles: (query) => execute(createFallbackAppRpcClient(runtime).checkProfiles.list(toListInput(query) as never)),
    createCheckProfile: (input) => execute(createFallbackAppRpcClient(runtime).checkProfiles.create(input as never), 201),
    getCheckProfile: (id) => execute(createFallbackAppRpcClient(runtime).checkProfiles.get({ params: { id } } as never)),
    updateCheckProfile: (id, input) =>
      execute(createFallbackAppRpcClient(runtime).checkProfiles.update({ params: { id }, body: input } as never)),
    deleteCheckProfile: (id) => execute(createFallbackAppRpcClient(runtime).checkProfiles.delete({ params: { id } } as never)),
    getCheckProfileBaseline: (id) => execute(createFallbackAppRpcClient(runtime).checkProfiles.baseline.get({ params: { id } } as never)),
    setCheckProfileBaseline: (id, input) =>
      execute(createFallbackAppRpcClient(runtime).checkProfiles.baseline.set({ params: { id }, body: input } as never)),
    clearCheckProfileBaseline: (id) =>
      execute(createFallbackAppRpcClient(runtime).checkProfiles.baseline.clear({ params: { id } } as never)),
    listCheckProfileRuns: (id, query) =>
      execute(createFallbackAppRpcClient(runtime).checkProfiles.runs.list({ params: { id }, query } as never)),
    runCheckProfile: (id, ctx) =>
      execute(createFallbackAppRpcClient(runtime, ctx?.requesterIp).checkProfiles.runs.create({ params: { id } } as never), 201),
    getCheckProfileRun: (id, runId) =>
      execute(createFallbackAppRpcClient(runtime).checkProfiles.runs.get({ params: { id, runId } } as never)),
    getCheckProfileRunComparison: (id, runId, query) =>
      execute(createFallbackAppRpcClient(runtime).checkProfiles.runs.compare({
        params: { id, runId },
        query: parseCompareQuery(id, runId, query)
      } as never)),
    getLatestCheckProfileComparison: (id) =>
      execute(createFallbackAppRpcClient(runtime).checkProfiles.compareLatest({ params: { id } } as never)),
    getBaselineCheckProfileComparison: (id) =>
      execute(createFallbackAppRpcClient(runtime).checkProfiles.compareBaseline({ params: { id } } as never)),
    getCheckProfileReport: (id) => execute(createFallbackAppRpcClient(runtime).checkProfiles.report({ params: { id } } as never)),
    exportCheckProfileReport: async (id, format) => {
      const exportResource = await createFallbackAppRpcClient(runtime).checkProfiles.reportExport({
        params: { id },
        body: { format }
      } as never);

      return new Response(exportResource.body, {
        headers: {
          'content-type': exportResource.contentType,
          'content-disposition': `attachment; filename="${exportResource.filename}"`
        }
      });
    },
    listComparisons: (query) => execute(createFallbackAppRpcClient(runtime).comparisons.list(toListInput(query) as never)),
    listExports: (query) => execute(createFallbackAppRpcClient(runtime).exports.list(toListInput(query) as never)),
    listAnalyses: (query) => execute(createFallbackAppRpcClient(runtime).analyses.list(toListInput(query) as never)),
    dispatchScheduler: (now) =>
      execute(createFallbackOpsRpcClient(runtime).scheduler.dispatch({ now: now ?? null }))
  };
};

const createRpcClient = (binding: unknown): ControlPlaneClient => binding as ControlPlaneClient;

export const getRequesterIp = (request: Request) =>
  request.headers.get('cf-connecting-ip')
  ?? request.headers.get('x-forwarded-for')
  ?? request.headers.get('x-real-ip');

export const getControlPlaneClient = (platform: Platform): ControlPlaneClient => {
  const runtime = resolveRuntime(platform);

  if (runtime.CONTROL_BINDING_MODE !== 'disabled' && platform?.env?.EDGE_CONTROL) {
    return createRpcClient(platform.env.EDGE_CONTROL);
  }

  return createFallbackClient(runtime);
};

export const proxyControlResponse = async (responsePromise: Promise<Response>) =>
  proxyResponse(await responsePromise);

export const proxyControlStream = async (streamPromise: Promise<ReadableStream<Uint8Array>>) =>
  new Response(await streamPromise, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    }
  });
