import { describe, expect, test } from 'bun:test';
import type {
  ExecutionJob,
  ExecutionResourceContext,
  ExecutionResourceResultRequest,
  LatencyJobDetail
} from '@webperf/contracts';
import type { ExecutorApiClient } from './client';
import { createNetworkExecutionHandler, parseProbeBaseUrls } from './network-handler';
import { ExecutionFailure } from './runner';

const executionJob: ExecutionJob = {
  id: 'exec_job_network',
  kind: 'network_probe',
  resourceId: 'job_network',
  status: 'running',
  leaseOwner: 'executor-network',
  leaseExpiresAt: '2099-07-22T00:01:00.000Z',
  attemptCount: 1,
  maxAttempts: 3,
  availableAt: '2026-07-22T00:00:00.000Z',
  payload: {
    version: 'v1',
    jobIds: ['job_network'],
    checkId: null,
    runId: null
  },
  error: null,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  completedAt: null
};

const queuedJob = (): LatencyJobDetail => ({
  id: 'job_network',
  url: 'https://example.com/',
  status: 'queued',
  note: null,
  request: { method: 'GET', headers: [], body: null },
  monitorPolicy: {
    monitorType: 'latency',
    successRule: 'status_2xx_3xx',
    latencyThresholdMs: 500
  },
  requestedAt: '2026-07-22T00:00:00.000Z',
  startedAt: null,
  completedAt: null,
  requesterIp: null,
  selectedRegions: ['tokyo'],
  targets: [{
    jobId: 'job_network',
    region: 'tokyo',
    status: 'queued',
    attemptNo: 0,
    maxAttempts: 1,
    latencyMs: null,
    statusCode: null,
    success: null,
    probeImpl: null,
    measurement: null,
    execution: {
      runnerType: 'network_probe',
      provider: 'selfhost',
      locationMode: 'best_effort',
      region: 'tokyo',
      city: null,
      runnerVersion: 'probe-rs'
    },
    slotId: null,
    errorCode: null,
    errorClass: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    updatedAt: '2026-07-22T00:00:00.000Z'
  }],
  evaluation: null,
  summary: { total: 1, succeeded: 0, failed: 0, inflight: 1 }
});

const networkContext = (): ExecutionResourceContext => ({
  kind: 'network_probe',
  executionJob,
  payload: {
    version: 'v1',
    jobIds: ['job_network'],
    checkId: null,
    runId: null
  },
  jobs: [queuedJob()],
  check: null,
  run: null,
  comparedRun: null,
  comparedJobs: [],
  comparisonMode: null
});

const createClient = ({
  context = networkContext(),
  savedResults
}: {
  context?: ExecutionResourceContext;
  savedResults: ExecutionResourceResultRequest[];
}): ExecutorApiClient => ({
  claim: async () => null,
  start: async () => executionJob,
  renew: async () => executionJob,
  complete: async () => executionJob,
  fail: async () => executionJob,
  context: async () => context,
  saveResult: async (_id, result) => {
    savedResults.push(structuredClone(result));
  },
  enqueueFollowups: async () => ({ jobs: [] })
});

describe('network execution handler', () => {
  test('persists measuring and terminal states around a signed probe request', async () => {
    const savedResults: ExecutionResourceResultRequest[] = [];
    let probeRequest: Request | null = null;
    const client = createClient({ savedResults });
    const handler = createNetworkExecutionHandler({
      client,
      leaseOwner: 'executor-network',
      probeSharedSecret: 'network-handler-probe-secret',
      probeBaseUrls: { tokyo: 'http://probe.test:8080' },
      allowInsecureProbeHttp: true,
      fetchImpl: (async (input, init) => {
        probeRequest = new Request(input, init);
        return Response.json({
          measurement: {
            region: 'tokyo',
            url: 'https://example.com/',
            latencyMs: 123,
            measuredAt: '2026-07-22T00:00:05.000Z',
            statusCode: 200,
            success: true,
            probeImpl: 'rust',
            finalUrl: 'https://example.com/',
            redirectCount: 0,
            timings: {
              totalMs: 123,
              dnsMs: 12,
              tcpMs: null,
              tlsMs: null,
              ttfbMs: 80
            },
            tls: null,
            error: null
          }
        });
      }) as typeof fetch
    });

    await handler(executionJob, new AbortController().signal);

    expect(new URL(probeRequest!.url).pathname).toBe('/measure');
    const signedRequest = await probeRequest!.json();
    expect(signedRequest.signature).toMatch(/^[a-f0-9]+$/);
    expect(savedResults.length).toBeGreaterThanOrEqual(3);
    const finalResult = savedResults.at(-1)?.result;
    expect(finalResult?.kind).toBe('network_probe');
    if (finalResult?.kind !== 'network_probe') {
      throw new Error('Expected a network result');
    }
    expect(finalResult.jobs[0]?.status).toBe('succeeded');
    expect(finalResult.jobs[0]?.completedAt).not.toBeNull();
    expect(finalResult.jobs[0]?.evaluation?.thresholdBreached).toBe(false);
  });

  test('persists retryable state before surfacing a transient probe failure', async () => {
    const savedResults: ExecutionResourceResultRequest[] = [];
    const handler = createNetworkExecutionHandler({
      client: createClient({ savedResults }),
      leaseOwner: 'executor-network',
      probeSharedSecret: 'network-handler-probe-secret',
      probeBaseUrls: { tokyo: 'http://probe.test:8080' },
      allowInsecureProbeHttp: true,
      fetchImpl: (async () => new Response('Bearer raw-sensitive-probe-error', {
        status: 503
      })) as unknown as typeof fetch
    });

    let error: unknown;
    try {
      await handler(executionJob, new AbortController().signal);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ExecutionFailure);
    expect((error as ExecutionFailure).retryable).toBe(true);
    const retryResult = savedResults.at(-1)?.result;
    if (retryResult?.kind !== 'network_probe') {
      throw new Error('Expected a network result');
    }
    expect(retryResult.jobs[0]?.targets[0]).toMatchObject({
      status: 'queued',
      errorClass: 'retryable',
      errorCode: 'probe_http_503'
    });
    expect(JSON.stringify(savedResults)).not.toContain('raw-sensitive-probe-error');
  });

  test('validates configured probe origins as region-keyed HTTP origins', () => {
    expect(parseProbeBaseUrls('{"tokyo":"https://probe.example.com"}')).toEqual({
      tokyo: 'https://probe.example.com'
    });
    expect(parseProbeBaseUrls('{"tokyo":"http://127.0.0.1:8080"}')).toEqual({
      tokyo: 'http://127.0.0.1:8080'
    });
    expect(() => parseProbeBaseUrls('{"tokyo":"http://probe:8080"}')).toThrow(
      ExecutionFailure
    );
    expect(parseProbeBaseUrls('{"tokyo":"http://probe:8080"}', {
      allowInsecureHttp: true
    })).toEqual({
      tokyo: 'http://probe:8080'
    });
    expect(() => parseProbeBaseUrls('{"unknown":"https://probe.example.com"}')).toThrow(
      'invalid region entry'
    );
    expect(() => parseProbeBaseUrls('{"tokyo":"https://user:secret@probe.example.com"}')).toThrow(
      ExecutionFailure
    );
  });
});
