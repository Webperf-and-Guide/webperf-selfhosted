import { describe, expect, test } from 'bun:test';
import type {
  ExecutionJob,
  ExecutionResourceContext,
  ExecutionResourceResultRequest,
  LatencyJobDetail
} from '@webperf/contracts';
import { probeMeasurementTimeoutMs } from '@webperf/contracts';
import type { ExecutorApiClient } from './client';
import {
  createNetworkExecutionHandler,
  parseProbeBaseUrl,
  probeRetryDelayMs,
  probeTransportResponseTimeoutMs
} from './network-handler';
import { OutboundHttpPolicyError } from './outbound-http';
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
  region: 'local',
  targets: [{
    jobId: 'job_network',
    region: 'local',
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
      locationMode: 'fixed',
      region: 'local',
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
  test('allows the probe lifecycle to finish before its transport deadline', () => {
    expect(probeTransportResponseTimeoutMs).toBeGreaterThan(probeMeasurementTimeoutMs);
  });

  test('honors a bounded probe capacity retry delay', () => {
    expect(probeRetryDelayMs('40', 1, () => 0.5)).toBe(40_000);
    expect(probeRetryDelayMs('41', 1, () => 0.5)).toBe(1_000);
    expect(probeRetryDelayMs('invalid', 2, () => 0.5)).toBe(2_000);
  });

  test('persists measuring and terminal states around a signed probe request', async () => {
    const savedResults: ExecutionResourceResultRequest[] = [];
    let probeRequest: Request | null = null;
    const client = createClient({ savedResults });
    const handler = createNetworkExecutionHandler({
      client,
      leaseOwner: 'executor-network',
      probeSharedSecret: 'network-handler-probe-secret',
      probeBaseUrl: 'http://probe:8080',
      allowInsecureProbeHttp: true,
      requestImpl: async (input, init) => {
        probeRequest = new Request(input, {
          method: init.method,
          headers: init.headers,
          body: init.body,
          signal: init.signal
        });
        expect(init.addressPolicy).toBe('trusted-private');
        return Response.json({
          measurement: {
            region: 'local',
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
      }
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
      probeBaseUrl: 'http://probe.test:8080',
      allowInsecureProbeHttp: true,
      requestImpl: async (_input, init) => {
        expect(init.addressPolicy).toBe('public');
        return new Response('Bearer raw-sensitive-probe-error', { status: 503 });
      }
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

  test('defers a saturated probe retry for the advertised capacity window', async () => {
    const savedResults: ExecutionResourceResultRequest[] = [];
    const handler = createNetworkExecutionHandler({
      client: createClient({ savedResults }),
      leaseOwner: 'executor-network',
      probeSharedSecret: 'network-handler-probe-secret',
      probeBaseUrl: 'http://probe.test:8080',
      allowInsecureProbeHttp: true,
      requestImpl: async () => new Response(null, {
        status: 429,
        headers: { 'retry-after': '40' }
      })
    });

    let error: unknown;
    try {
      await handler(executionJob, new AbortController().signal);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ExecutionFailure);
    expect((error as ExecutionFailure).retryable).toBe(true);
    expect((error as ExecutionFailure).retryDelayMs).toBe(40_000);
    expect(savedResults.at(-1)?.result).toMatchObject({
      kind: 'network_probe',
      jobs: [{
        targets: [{
          status: 'queued',
          errorClass: 'retryable',
          errorCode: 'probe_http_429'
        }]
      }]
    });
  });

  test('rejects a probe response attributed to a different region', async () => {
    const savedResults: ExecutionResourceResultRequest[] = [];
    const handler = createNetworkExecutionHandler({
      client: createClient({ savedResults }),
      leaseOwner: 'executor-network',
      probeSharedSecret: 'network-handler-probe-secret',
      probeBaseUrl: 'http://probe.test:8080',
      allowInsecureProbeHttp: true,
      requestImpl: async () => Response.json({
        measurement: {
          region: 'frankfurt',
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
      })
    });

    await handler(executionJob, new AbortController().signal);

    const result = savedResults.at(-1)?.result;
    if (result?.kind !== 'network_probe') {
      throw new Error('Expected a network result');
    }
    expect(result.jobs[0]?.targets[0]).toMatchObject({
      region: 'local',
      status: 'failed',
      errorClass: 'terminal',
      errorCode: 'probe_region_mismatch',
      errorMessage: 'Network probe returned region "frankfurt" but expected "local"',
      measurement: null
    });
  });

  test('validates the configured single probe origin as a credential-free HTTP(S) origin', () => {
    expect(parseProbeBaseUrl('https://probe.example.com')).toBe('https://probe.example.com');
    expect(parseProbeBaseUrl('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(() => parseProbeBaseUrl('http://probe:8080')).toThrow(ExecutionFailure);
    expect(parseProbeBaseUrl('http://probe:8080', { allowInsecureHttp: true })).toBe('http://probe:8080');
    expect(() => parseProbeBaseUrl('https://user:secret@probe.example.com')).toThrow(ExecutionFailure);
    expect(() => parseProbeBaseUrl('')).toThrow('non-empty');
  });

  test('persists a terminal failure when DNS resolves outside the configured trust boundary', async () => {
    const savedResults: ExecutionResourceResultRequest[] = [];
    const handler = createNetworkExecutionHandler({
      client: createClient({ savedResults }),
      leaseOwner: 'executor-network',
      probeSharedSecret: 'network-handler-probe-secret',
      probeBaseUrl: 'https://probe.example.test',
      requestImpl: async () => {
        throw new OutboundHttpPolicyError(
          'address_blocked',
          'sensitive resolved address'
        );
      },
      logger: { error: () => { throw new Error('Policy failures must not be logged as transport failures'); } }
    });

    await handler(executionJob, new AbortController().signal);

    const result = savedResults.at(-1)?.result;
    if (result?.kind !== 'network_probe') {
      throw new Error('Expected a network result');
    }
    expect(result.jobs[0]?.targets[0]).toMatchObject({
      status: 'failed',
      errorClass: 'terminal',
      errorCode: 'probe_origin_blocked',
      errorMessage: 'Network probe origin resolved to a blocked address'
    });
    expect(JSON.stringify(savedResults)).not.toContain('sensitive resolved address');
  });
});
