import { ORPCError, createORPCClient, safe } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { ExportResource, JobSnapshotEvent, ListQuery } from '@webperf/contracts';
import { appContract, opsContract } from '@webperf/contracts';
import { parseWebEnv } from '@webperf/env-schema/public';
import { env as privateEnv } from '$env/dynamic/private';

type Platform = App.Platform | undefined;

export type ControlListQuery = ListQuery;

type AppRpcClient = ContractRouterClient<typeof appContract>;
type OpsRpcClient = ContractRouterClient<typeof opsContract>;

export type ControlPlaneClient = {
  app: AppRpcClient;
  ops: OpsRpcClient;
};

type ListInput = Parameters<AppRpcClient['properties']['list']>[0];
type RunComparisonInput = Parameters<AppRpcClient['checkProfiles']['runs']['compare']>[0];
type RunComparisonQuery = RunComparisonInput['query'];

const createJobSseStream = (getSnapshot: () => Promise<JobSnapshotEvent>) => {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const pump = async () => {
        for (let i = 0; i < 60; i += 1) {
          const [error, snapshot, hasError, isSuccess] = await safe(getSnapshot());

          if (!isSuccess) {
            const normalized = normalizeError(
              hasError ? error : new Error('Unexpected control-plane streaming error')
            );
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ error: normalized.message, code: normalized.code })}\n\n`)
            );
            break;
          }

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

const normalizeError = (error: unknown) =>
  error instanceof ORPCError
    ? error
    : new ORPCError('INTERNAL_SERVER_ERROR', {
        message: error instanceof Error ? error.message : 'Unexpected control-plane error'
      });

const toErrorResponse = (error: unknown) => {
  const normalized = normalizeError(error);

  return jsonResponse(
    {
      error: normalized.message,
      code: normalized.code,
      data: normalized.data ?? null
    },
    normalized.status
  );
};

const toProcedureResponse = async <T>(promise: Promise<T>, successStatus = 200) => {
  const [error, data, hasError, isSuccess] = await safe(promise);

  if (isSuccess) {
    return data instanceof Response ? data : jsonResponse(data, successStatus);
  }

  return toErrorResponse(hasError ? error : new Error('Unexpected control-plane error'));
};

const createRpcLink = (
  runtime: ReturnType<typeof resolveRuntime>,
  path: string,
  requesterIp?: string | null
) =>
  new RPCLink({
    url: new URL(path, runtime.CONTROL_BASE_URL).toString(),
    fetch: (input, init) => {
      const request = new Request(input, init);
      const headers = buildHeaders(requesterIp, request.headers);
      return fetch(new Request(request, { headers, redirect: 'manual' }));
    }
  });

const createAppRpcClient = (
  runtime: ReturnType<typeof resolveRuntime>,
  requesterIp?: string | null
): AppRpcClient => createORPCClient(createRpcLink(runtime, '/rpc/app', requesterIp));

const createOpsRpcClient = (
  runtime: ReturnType<typeof resolveRuntime>,
  requesterIp?: string | null
): OpsRpcClient => createORPCClient(createRpcLink(runtime, '/rpc/ops', requesterIp));

export const toListInput = (query?: ControlListQuery): ListInput => (query ? { query } : {});

export const readRunComparisonQuery = (query?: string): RunComparisonQuery => {
  const search = new URLSearchParams(query ?? '');
  const against = search.get('against');

  return {
    against:
      against === 'baseline' || against === 'previous' || against === 'custom'
        ? against
        : undefined,
    againstRunId: search.get('againstRunId') ?? undefined
  };
};

export const getRequesterIp = (request: Request) =>
  request.headers.get('cf-connecting-ip')
  ?? request.headers.get('x-forwarded-for')
  ?? request.headers.get('x-real-ip');

export const getControlPlaneClient = (
  platform: Platform,
  requesterIp?: string | null
): ControlPlaneClient => {
  const runtime = resolveRuntime(platform);

  return {
    app: createAppRpcClient(runtime, requesterIp),
    ops: createOpsRpcClient(runtime, requesterIp)
  };
};

export const proxyControlResponse = async <T>(promise: Promise<T>, successStatus = 200) =>
  proxyResponse(await toProcedureResponse(promise, successStatus));

export const proxyControlDownload = async (promise: Promise<ExportResource>) =>
  proxyResponse(
    await toProcedureResponse(
      promise.then(
        (resource) =>
          new Response(resource.body, {
            headers: {
              'content-type': resource.contentType,
              'content-disposition': `attachment; filename="${resource.filename}"`
            }
          })
      )
    )
  );

export const proxyControlStream = async (getSnapshot: () => Promise<JobSnapshotEvent>) =>
  new Response(createJobSseStream(getSnapshot), {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    }
  });
