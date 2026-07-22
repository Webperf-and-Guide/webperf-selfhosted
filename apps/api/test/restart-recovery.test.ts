import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createExecutorApiClient } from '../../executor/src/client';
import { createNetworkExecutionHandler } from '../../executor/src/network-handler';
import { processExecutionJob, type ExecutorLogger } from '../../executor/src/runner';

type ApiProcess = {
  baseUrl: string;
  subprocess: ReturnType<typeof Bun.spawn>;
  stop(): Promise<void>;
};

const repositoryRoot = resolve(import.meta.dir, '../../..');
const testInternalSecret = 'restart-recovery-internal-secret';
const testAdminToken = 'restart-recovery-admin-token';
const testProbeSecret = 'restart-recovery-probe-secret';
const tempDirectories: string[] = [];
const apiProcesses: ApiProcess[] = [];
const testServers: Array<{ stop(closeActiveConnections?: boolean): Promise<void> }> = [];

afterEach(async () => {
  for (const apiProcess of apiProcesses.splice(0)) {
    await apiProcess.stop();
  }

  for (const server of testServers.splice(0)) {
    await server.stop(true);
  }

  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();

    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe('durable execution restart recovery', () => {
  test('reclaims an expired running lease after API and executor restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'webperf-restart-recovery-'));
    tempDirectories.push(directory);
    const databasePath = join(directory, 'webperf.sqlite');
    const probeRequests: unknown[] = [];
    const probe = startProbe(probeRequests);

    const firstApi = await startApi(databasePath, probe.port);
    const createJobResponse = await fetch(`${firstApi.baseUrl}/v1/jobs`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testAdminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ url: 'https://example.com/', regions: ['tokyo'] })
    });
    expect(createJobResponse.status).toBe(201);
    const createdJob = await createJobResponse.json() as { job: { id: string } };

    const firstExecutor = createExecutorApiClient({
      baseUrl: firstApi.baseUrl,
      internalSecret: testInternalSecret
    });
    const firstLease = { leaseOwner: 'executor-before-restart', leaseDurationMs: 1_000 };
    const firstClaim = await firstExecutor.claim(firstLease);

    expect(firstClaim).toMatchObject({
      kind: 'network_probe',
      status: 'leased',
      attemptCount: 1,
      leaseOwner: firstLease.leaseOwner
    });
    expect(await firstExecutor.start(firstClaim!.id, firstLease)).toMatchObject({
      status: 'running',
      leaseOwner: firstLease.leaseOwner
    });

    await firstApi.stop();
    await Bun.sleep(1_100);

    const secondApi = await startApi(databasePath, probe.port);
    const secondExecutor = createExecutorApiClient({
      baseUrl: secondApi.baseUrl,
      internalSecret: testInternalSecret
    });
    const secondLease = { leaseOwner: 'executor-after-restart', leaseDurationMs: 5_000 };
    const recovered = await secondExecutor.claim(secondLease);

    expect(recovered).toMatchObject({
      id: firstClaim!.id,
      status: 'leased',
      attemptCount: 2,
      leaseOwner: secondLease.leaseOwner
    });

    const completedEvents: Record<string, unknown>[] = [];
    const logger: ExecutorLogger = {
      info: (event) => completedEvents.push(event),
      error: () => {}
    };
    const networkHandler = createNetworkExecutionHandler({
      client: secondExecutor,
      leaseOwner: secondLease.leaseOwner,
      probeSharedSecret: testProbeSecret,
      probeBaseUrls: { tokyo: `http://127.0.0.1:${probe.port}` }
    });
    await processExecutionJob({
      client: secondExecutor,
      handler: networkHandler,
      executionJob: recovered!,
      lease: secondLease,
      heartbeatIntervalMs: 1_000,
      maxExecutionMs: 2_000,
      logger
    });
    expect(completedEvents).toContainEqual(expect.objectContaining({
      event: 'execution_completed',
      executionJobId: recovered!.id,
      attemptCount: 2
    }));
    expect(probeRequests).toHaveLength(1);
    await secondApi.stop();

    const persisted = new Database(databasePath, { readonly: true });
    expect(persisted
      .query<{
        status: string;
        attempt_count: number;
        lease_owner: string | null;
        completed_at: string | null;
      }, [string]>(`
        SELECT status, attempt_count, lease_owner, completed_at
        FROM execution_jobs
        WHERE id = ?
      `)
      .get(recovered!.id)).toMatchObject({
        status: 'succeeded',
        attempt_count: 2,
        lease_owner: null,
        completed_at: expect.any(String)
      });
    persisted.close();

    const thirdApi = await startApi(databasePath, probe.port);
    const thirdExecutor = createExecutorApiClient({
      baseUrl: thirdApi.baseUrl,
      internalSecret: testInternalSecret
    });
    expect(await thirdExecutor.claim({
      leaseOwner: 'executor-final',
      leaseDurationMs: 5_000
    })).toBeNull();
    const persistedJobResponse = await fetch(
      `${thirdApi.baseUrl}/v1/jobs/${encodeURIComponent(createdJob.job.id)}`,
      { headers: { authorization: `Bearer ${testAdminToken}` } }
    );
    expect(persistedJobResponse.status).toBe(200);
    expect(await persistedJobResponse.json()).toMatchObject({ status: 'succeeded' });
  }, 20_000);
});

const startApi = async (databasePath: string, probePort: number): Promise<ApiProcess> => {
  const port = await openPort();
  const subprocess = Bun.spawn([process.execPath, 'apps/api/src/index.ts'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      SELFHOST_API_HOST: '127.0.0.1',
      SELFHOST_API_PORT: String(port),
      SELFHOST_DATABASE_PATH: databasePath,
      SELFHOST_RETENTION_DAYS: '30',
      SELFHOST_MIGRATION_BACKUP: 'false',
      SELFHOST_ADMIN_TOKEN: testAdminToken,
      SELFHOST_ADMIN_TOKEN_NEXT: '',
      SELFHOST_INTERNAL_SECRET: testInternalSecret,
      SELFHOST_INTERNAL_SECRET_NEXT: '',
      SELFHOST_ACTIVE_REGION_CODES_JSON: '["tokyo"]',
      SELFHOST_REGION_IDS_JSON: '{"tokyo":"JP"}',
      SELFHOST_PROBE_BASE_URLS_JSON: `{"tokyo":"http://127.0.0.1:${probePort}"}`,
      SELFHOST_BROWSER_AUDIT_BASE_URL: '',
      SELFHOST_MAX_TARGET_ATTEMPTS: '3'
    },
    stdout: 'ignore',
    stderr: 'ignore'
  });
  let stopped = false;
  const apiProcess: ApiProcess = {
    baseUrl: `http://127.0.0.1:${port}`,
    subprocess,
    async stop() {
      if (stopped) {
        return;
      }

      stopped = true;

      if (subprocess.exitCode == null) {
        subprocess.kill('SIGTERM');
      }

      await subprocess.exited;
    }
  };
  apiProcesses.push(apiProcess);
  await waitForHealth(apiProcess);
  return apiProcess;
};

const startProbe = (requests: unknown[]) => {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== '/measure') {
        return new Response('not found', { status: 404 });
      }

      const payload = await request.json() as { url: string; region: string };
      requests.push(payload);
      return Response.json({
        measurement: {
          region: payload.region,
          url: payload.url,
          latencyMs: 120,
          measuredAt: new Date().toISOString(),
          statusCode: 200,
          success: true,
          probeImpl: 'rust',
          finalUrl: payload.url,
          redirectCount: 0,
          timings: {
            totalMs: 120,
            dnsMs: 10,
            tcpMs: null,
            tlsMs: null,
            ttfbMs: 75
          },
          tls: null,
          error: null
        }
      });
    }
  });
  testServers.push(server);

  if (server.port == null) {
    throw new Error('Restart recovery probe did not expose a port');
  }

  return { port: server.port };
};

const openPort = async () => await new Promise<number>((resolvePort, rejectPort) => {
  const server = createServer();
  server.once('error', rejectPort);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();

    if (!address || typeof address === 'string') {
      server.close();
      rejectPort(new Error('Failed to allocate API restart test port'));
      return;
    }

    const port = address.port;
    server.close((error) => error ? rejectPort(error) : resolvePort(port));
  });
});

const waitForHealth = async (apiProcess: ApiProcess) => {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (apiProcess.subprocess.exitCode != null) {
      throw new Error(`Restart test API exited before health check (${apiProcess.subprocess.exitCode})`);
    }

    try {
      const response = await fetch(`${apiProcess.baseUrl}/health`);

      if (response.ok) {
        return;
      }
    } catch {
      // The API has not bound the port yet.
    }

    await Bun.sleep(25);
  }

  throw new Error('Timed out waiting for restarted API health');
};
