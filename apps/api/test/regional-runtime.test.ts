import { afterEach, describe, expect, test } from 'bun:test';
import {
  regionalExecutionResultSchema,
  type RegionalExecutionRequest
} from '@webperf/contracts';
import {
  createRegionalExecutionSignature,
  verifyRegionalResultSignature
} from '@webperf/domain-core';
import { createExecutorApiClient } from '../../executor/src/client';
import { createNetworkExecutionHandler } from '../../executor/src/network-handler';
import { processExecutionJob, type ExecutorLogger } from '../../executor/src/runner';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const adminToken = 'regional-runtime-admin-token';
const internalSecret = 'regional-runtime-internal-secret';
const probeSecret = 'regional-runtime-probe-secret';
const regionalSecret = 'regional-runtime-cloud-secret';
const regionalNextSecret = 'regional-runtime-cloud-next-secret';
const apiProcesses: Array<ReturnType<typeof Bun.spawn>> = [];
const servers: Array<{ stop(closeActiveConnections?: boolean): void }> = [];
const tempDirectories: string[] = [];

afterEach(async () => {
  for (const process of apiProcesses.splice(0)) {
    if (process.exitCode == null) {
      process.kill('SIGTERM');
    }
    await process.exited;
  }
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('regional runtime handoff', () => {
  test('accepts, deduplicates, executes, signs, and cancels Cloud work', async () => {
    const probeRequests: unknown[] = [];
    const retryAttempts = new Map<string, number>();
    const probe = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const payload = await request.json() as { url: string; region: string };
        probeRequests.push(payload);
        if (payload.url.includes('/retry-')) {
          const attempt = (retryAttempts.get(payload.url) ?? 0) + 1;
          retryAttempts.set(payload.url, attempt);
          if (attempt === 1) {
            return new Response('retry', { status: 503 });
          }
        }
        return Response.json({
          measurement: {
            region: payload.region,
            url: payload.url,
            latencyMs: 87,
            measuredAt: new Date().toISOString(),
            statusCode: 200,
            success: true,
            probeImpl: 'rust',
            finalUrl: payload.url,
            redirectCount: 0,
            timings: {
              totalMs: 87,
              dnsMs: 8,
              tcpMs: null,
              tlsMs: null,
              ttfbMs: 52
            },
            tls: null,
            error: null
          }
        });
      }
    });
    servers.push(probe);
    let harness = await startRegionalRuntime(probe.port!);

    const healthResponse = await fetch(`${harness.baseUrl}/health`);
    expect(healthResponse.status).toBe(200);
    expect(await healthResponse.json()).toEqual({
      service: 'webperf-api',
      ok: true
    });

    const capabilitiesResponse = await fetch(`${harness.baseUrl}/v1/regional-capabilities`);
    expect(capabilitiesResponse.status).toBe(200);
    expect(capabilitiesResponse.headers.get('cache-control')).toBe('no-store');
    expect(await capabilitiesResponse.json()).toMatchObject({
      protocolVersion: 1,
      regionId: 'tokyo',
      runnerTypes: ['network_probe'],
      runtime: {
        version: '0.3.0-test',
        imageDigest: `sha256:${'a'.repeat(64)}`
      },
      runner: {
        id: 'probe-rs',
        implementation: 'rust',
        imageDigest: `sha256:${'b'.repeat(64)}`
      }
    });
    const openApiResponse = await fetch(`${harness.baseUrl}/openapi/regional-runtime.json`);
    expect(openApiResponse.status).toBe(200);
    expect(await openApiResponse.json()).toMatchObject({
      paths: {
        '/v1/regional-capabilities': {
          get: { summary: 'Get regional runtime capabilities' }
        },
        '/v1/regional-executions': {
          post: {
            summary: 'Submit an idempotent regional execution batch',
            responses: {
              '200': {
                description: 'Returned the existing execution for an idempotent replay'
              },
              '202': {
                description: 'Accepted a new regional execution'
              }
            }
          }
        }
      }
    });

    expect((await fetch(`${harness.baseUrl}/v1/sites`, {
      headers: { authorization: `Bearer ${adminToken}` }
    })).status).toBe(404);
    expect((await fetch(`${harness.baseUrl}/rpc/app`, {
      headers: { authorization: `Bearer ${adminToken}` }
    })).status).toBe(404);
    const internalHeaders = {
      authorization: `Bearer ${internalSecret}`,
      'content-type': 'application/json'
    };
    expect((await fetch(
      `${harness.baseUrl}/internal/execution-jobs/not-a-network-job/artifact-upload-grant`,
      {
        method: 'POST',
        headers: internalHeaders,
        body: '{}'
      }
    )).status).toBe(404);
    expect((await fetch(
      `${harness.baseUrl}/internal/browser-audits/not-a-network-job/artifacts`,
      {
        method: 'POST',
        headers: internalHeaders,
        body: '{}'
      }
    )).status).toBe(404);
    expect((await fetch(`${harness.baseUrl}/internal/future-managed-surface`, {
      method: 'POST',
      headers: internalHeaders,
      body: '{}'
    })).status).toBe(404);

    const unsigned = createUnsignedRequest('release_123:tokyo');
    expect((await fetch(`${harness.baseUrl}/v1/regional-executions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    })).status).toBe(401);
    const createResponse = await sendRegionalExecution(harness.baseUrl, unsigned);
    expect(createResponse.status).toBe(202);
    const queued = regionalExecutionResultSchema.parse(await createResponse.json());
    expect(queued.status).toBe('queued');
    await expectVerifiedResult(queued);

    const retried = {
      ...unsigned,
      timestamp: new Date().toISOString()
    };
    expect((await sendRegionalExecution(harness.baseUrl, retried)).status).toBe(200);

    const conflicting = {
      ...retried,
      targets: [{
        ...retried.targets[0]!,
        url: 'https://example.org/'
      }]
    };
    expect((await sendRegionalExecution(harness.baseUrl, conflicting)).status).toBe(409);

    const expired = {
      ...createUnsignedRequest('expired:tokyo'),
      timestamp: new Date(Date.now() - 10 * 60_000).toISOString()
    };
    expect((await sendRegionalExecution(harness.baseUrl, expired)).status).toBe(401);

    const stagedClient = createExecutorApiClient({
      baseUrl: harness.baseUrl,
      internalSecret
    });
    const stagedLease = {
      leaseOwner: 'regional-runtime-staged-executor',
      leaseDurationMs: 60_000
    };
    const stagedExecution = await stagedClient.claim(stagedLease);
    expect(stagedExecution).not.toBeNull();
    const stagedRunning = await stagedClient.start(stagedExecution!.id, stagedLease);
    const stagedHandler = createNetworkExecutionHandler({
      client: stagedClient,
      leaseOwner: stagedLease.leaseOwner,
      probeSharedSecret: probeSecret,
      probeBaseUrl: `http://127.0.0.1:${probe.port!}`
    });
    await stagedHandler(stagedRunning, new AbortController().signal);

    const persistedBeforeQueueCompletion = regionalExecutionResultSchema.parse(
      await (await fetch(
        `${harness.baseUrl}/v1/regional-executions/${
          encodeURIComponent(unsigned.idempotencyKey)
        }`,
        { headers: regionalAuthorization() }
      )).json()
    );
    expect(persistedBeforeQueueCompletion.status).toBe('running');
    expect(persistedBeforeQueueCompletion.targets[0]?.status).toBe('running');

    await stagedClient.complete(stagedRunning.id, {
      leaseOwner: stagedLease.leaseOwner
    });
    expect(probeRequests).toHaveLength(1);

    const succeededResponse = await fetch(
      `${harness.baseUrl}/v1/regional-executions/${encodeURIComponent(unsigned.idempotencyKey)}`,
      { headers: regionalAuthorization() }
    );
    expect(succeededResponse.status).toBe(200);
    expect(succeededResponse.headers.get('cache-control')).toBe('no-store');
    const succeeded = regionalExecutionResultSchema.parse(await succeededResponse.json());
    expect(succeeded).toMatchObject({
      status: 'succeeded',
      targets: [{
        targetId: 'homepage',
        status: 'succeeded',
        region: 'tokyo',
        statusCode: 200,
        success: true
      }]
    });
    await expectVerifiedResult(succeeded);

    const independentRetries = {
      ...createUnsignedRequest('independent_retries:tokyo'),
      targets: ['a', 'b'].map((suffix) => ({
        targetId: `retry-${suffix}`,
        url: `https://example.com/retry-${suffix}`,
        request: {
          method: 'GET' as const,
          headers: [],
          body: null
        }
      }))
    };
    expect((await sendRegionalExecution(harness.baseUrl, independentRetries)).status).toBe(202);
    await drainRegionalExecutions(harness.baseUrl, probe.port!);
    await Bun.sleep(1_100);
    await drainRegionalExecutions(harness.baseUrl, probe.port!);
    const independentlyRetried = regionalExecutionResultSchema.parse(
      await (await fetch(
        `${harness.baseUrl}/v1/regional-executions/${
          encodeURIComponent(independentRetries.idempotencyKey)
        }`,
        { headers: regionalAuthorization() }
      )).json()
    );
    expect(independentlyRetried.status).toBe('succeeded');
    expect(independentlyRetried.targets.every((target) => target.status === 'succeeded')).toBe(true);
    expect([...retryAttempts.values()]).toEqual([2, 2]);

    const completedCancellation = regionalExecutionResultSchema.parse(
      await (await fetch(
        `${harness.baseUrl}/v1/regional-executions/${encodeURIComponent(unsigned.idempotencyKey)}`,
        {
          method: 'DELETE',
          headers: regionalAuthorization()
        }
      )).json()
    );
    expect(completedCancellation.status).toBe('succeeded');

    const cancellable = createUnsignedRequest('cancel_123:tokyo');
    expect((await sendRegionalExecution(harness.baseUrl, cancellable)).status).toBe(202);
    const cancelledResponse = await fetch(
      `${harness.baseUrl}/v1/regional-executions/${encodeURIComponent(cancellable.idempotencyKey)}`,
      {
        method: 'DELETE',
        headers: regionalAuthorization()
      }
    );
    expect(cancelledResponse.status).toBe(200);
    const cancelled = regionalExecutionResultSchema.parse(await cancelledResponse.json());
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.targets[0]?.status).toBe('cancelled');
    await expectVerifiedResult(cancelled);

    const cancellationRace = createUnsignedRequest('cancel_after_measurement:tokyo');
    expect((await sendRegionalExecution(harness.baseUrl, cancellationRace)).status).toBe(202);
    const raceExecution = await stagedClient.claim(stagedLease);
    expect(raceExecution).not.toBeNull();
    const raceRunning = await stagedClient.start(raceExecution!.id, stagedLease);
    await stagedHandler(raceRunning, new AbortController().signal);
    const raceBeforeCancellation = regionalExecutionResultSchema.parse(
      await (await fetch(
        `${harness.baseUrl}/v1/regional-executions/${
          encodeURIComponent(cancellationRace.idempotencyKey)
        }`,
        { headers: regionalAuthorization() }
      )).json()
    );
    expect(raceBeforeCancellation.status).toBe('running');
    const measurementFinishedAt = raceBeforeCancellation.targets[0]?.finishedAt;
    expect(measurementFinishedAt).not.toBeNull();
    await Bun.sleep(10);
    const raceCancelled = regionalExecutionResultSchema.parse(
      await (await fetch(
        `${harness.baseUrl}/v1/regional-executions/${
          encodeURIComponent(cancellationRace.idempotencyKey)
        }`,
        {
          method: 'DELETE',
          headers: regionalAuthorization()
        }
      )).json()
    );
    expect(raceCancelled.status).toBe('cancelled');
    expect(raceCancelled.targets[0]?.status).toBe('cancelled');
    expect(raceCancelled.targets[0]?.finishedAt).toBe(raceCancelled.completedAt);
    expect(Date.parse(raceCancelled.completedAt!))
      .toBeGreaterThan(Date.parse(measurementFinishedAt!));

    const nextKeyBatch = {
      ...createUnsignedRequest('next_key_batch:tokyo'),
      keyVersion: 'next' as const,
      targets: Array.from({ length: 21 }, (_, index) => ({
        targetId: `route-${index}`,
        url: `https://example.com/route-${index}`,
        request: {
          method: 'GET' as const,
          headers: [],
          body: null
        }
      }))
    };
    expect((await sendRegionalExecution(harness.baseUrl, nextKeyBatch)).status).toBe(202);
    const nextKeyCancelledResponse = await fetch(
      `${harness.baseUrl}/v1/regional-executions/${encodeURIComponent(nextKeyBatch.idempotencyKey)}`,
      {
        method: 'DELETE',
        headers: regionalAuthorization(regionalNextSecret)
      }
    );
    const nextKeyCancelled = regionalExecutionResultSchema.parse(
      await nextKeyCancelledResponse.json()
    );
    expect(nextKeyCancelled.targets).toHaveLength(21);
    expect(nextKeyCancelled.targets.every((target) => target.status === 'cancelled')).toBe(true);
    expect(nextKeyCancelled.keyVersion).toBe('next');
    await expectVerifiedResult(nextKeyCancelled);

    expect((await fetch(
      `${harness.baseUrl}/v1/regional-executions/${encodeURIComponent(unsigned.idempotencyKey)}`,
      { headers: { authorization: `Bearer ${adminToken}` } }
    )).status).toBe(401);

    await stopApiProcess(harness.process);
    harness = await startRegionalRuntime(probe.port!, {
      directory: harness.directory,
      regionId: 'frankfurt',
      regionLabel: 'Frankfurt',
      maxTargetAttempts: 1,
      runtimeImageDigest: `sha256:${'c'.repeat(64)}`,
      probeImageDigest: `sha256:${'d'.repeat(64)}`
    });

    const replayAfterLimitChange = await sendRegionalExecution(harness.baseUrl, {
      ...unsigned,
      timestamp: new Date().toISOString()
    });
    expect(replayAfterLimitChange.status).toBe(200);
    const replayed = regionalExecutionResultSchema.parse(
      await replayAfterLimitChange.json()
    );
    expect(replayed.provenance).toMatchObject({
      regionId: 'tokyo',
      runtime: {
        imageDigest: `sha256:${'a'.repeat(64)}`
      },
      runner: {
        imageDigest: `sha256:${'b'.repeat(64)}`
      }
    });
    expect(replayed.targets[0]?.region).toBe('tokyo');
    await expectVerifiedResult(replayed);

    const rejectedNewAdmission = await sendRegionalExecution(
      harness.baseUrl,
      createUnsignedRequest('over_new_limit:frankfurt')
    );
    expect(rejectedNewAdmission.status).toBe(400);
  }, 20_000);
});

const createUnsignedRequest = (
  idempotencyKey: string
): Omit<RegionalExecutionRequest, 'signature'> => ({
  idempotencyKey,
  runnerType: 'network_probe',
  targets: [{
    targetId: 'homepage',
    url: 'https://example.com/',
    request: {
      method: 'GET',
      headers: [],
      body: null
    }
  }],
  deadlineMs: 60_000,
  maxAttempts: 2,
  timestamp: new Date().toISOString(),
  keyVersion: 'current'
});

const sendRegionalExecution = async (
  baseUrl: string,
  unsigned: Omit<RegionalExecutionRequest, 'signature'>
) => {
  const signingSecret = unsigned.keyVersion === 'current'
    ? regionalSecret
    : regionalNextSecret;
  return fetch(`${baseUrl}/v1/regional-executions`, {
    method: 'POST',
    headers: {
      ...regionalAuthorization(signingSecret),
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      ...unsigned,
      signature: await createRegionalExecutionSignature(signingSecret, unsigned)
    })
  });
};

const regionalAuthorization = (secret = regionalSecret) => ({
  authorization: `Bearer ${secret}`
});

const expectVerifiedResult = async (
  result: ReturnType<typeof regionalExecutionResultSchema.parse>
) => {
  const { signature, ...unsigned } = result;
  const signingSecret = result.keyVersion === 'next'
    ? regionalNextSecret
    : regionalSecret;
  expect(await verifyRegionalResultSignature(
    signingSecret,
    unsigned,
    signature
  )).toBe(true);
};

const startRegionalRuntime = async (
  probePort: number,
  options: {
    directory?: string;
    regionId?: string;
    regionLabel?: string;
    maxTargetAttempts?: number;
    runtimeImageDigest?: string;
    probeImageDigest?: string;
  } = {}
) => {
  const directory = options.directory
    ?? mkdtempSync(join(tmpdir(), 'webperf-regional-runtime-'));
  if (!options.directory) {
    tempDirectories.push(directory);
  }
  const port = await findOpenPort();
  const subprocess = Bun.spawn([process.execPath, 'apps/api/src/index.ts'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      SELFHOST_API_HOST: '127.0.0.1',
      SELFHOST_API_PORT: String(port),
      SELFHOST_DATABASE_PATH: join(directory, 'webperf.sqlite'),
      SELFHOST_ARTIFACTS_PATH: join(directory, 'artifacts'),
      SELFHOST_ADMIN_TOKEN: adminToken,
      SELFHOST_INTERNAL_SECRET: internalSecret,
      SELFHOST_REGION_ID: options.regionId ?? 'tokyo',
      SELFHOST_REGION_LABEL: options.regionLabel ?? 'Tokyo',
      SELFHOST_PROBE_BASE_URL: `http://127.0.0.1:${probePort}`,
      SELFHOST_MAX_TARGET_ATTEMPTS: String(options.maxTargetAttempts ?? 3),
      SELFHOST_SCHEDULER_MODE: 'disabled',
      SELFHOST_RUNTIME_MODE: 'regional-runtime',
      REGIONAL_RUNTIME_SHARED_SECRET: regionalSecret,
      REGIONAL_RUNTIME_SHARED_SECRET_NEXT: regionalNextSecret,
      WEBPERF_RUNTIME_VERSION: '0.3.0-test',
      WEBPERF_RUNTIME_IMAGE_DIGEST:
        options.runtimeImageDigest ?? `sha256:${'a'.repeat(64)}`,
      WEBPERF_PROBE_IMAGE_DIGEST:
        options.probeImageDigest ?? `sha256:${'b'.repeat(64)}`
    },
    stdout: 'ignore',
    stderr: 'inherit'
  });
  apiProcesses.push(subprocess);
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, subprocess);
  return { baseUrl, directory, process: subprocess };
};

const stopApiProcess = async (
  subprocess: ReturnType<typeof Bun.spawn>
) => {
  if (subprocess.exitCode == null) {
    subprocess.kill('SIGTERM');
  }
  await subprocess.exited;
};

const drainRegionalExecutions = async (baseUrl: string, probePort: number) => {
  const client = createExecutorApiClient({
    baseUrl,
    internalSecret
  });
  const leaseOwner = 'regional-runtime-test-executor';
  const handler = createNetworkExecutionHandler({
    client,
    leaseOwner,
    probeSharedSecret: probeSecret,
    probeBaseUrl: `http://127.0.0.1:${probePort}`
  });
  const logger: ExecutorLogger = {
    info: () => {},
    error: () => {}
  };

  while (true) {
    const execution = await client.claim({ leaseOwner, leaseDurationMs: 60_000 });
    if (!execution) {
      return;
    }
    await processExecutionJob({
      client,
      handler,
      executionJob: execution,
      lease: { leaseOwner, leaseDurationMs: 60_000 },
      heartbeatIntervalMs: 20_000,
      maxExecutionMs: 60_000,
      logger
    });
  }
};

const waitForHealth = async (
  baseUrl: string,
  subprocess: ReturnType<typeof Bun.spawn>
) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (subprocess.exitCode != null) {
      throw new Error(`Regional runtime exited with ${subprocess.exitCode}`);
    }
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) {
        return;
      }
    } catch {
      // keep polling
    }
    await Bun.sleep(50);
  }
  throw new Error('Regional runtime did not become healthy');
};

const findOpenPort = async () => {
  const server = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      data() {}
    }
  });
  const port = server.port;
  server.stop();
  return port;
};
