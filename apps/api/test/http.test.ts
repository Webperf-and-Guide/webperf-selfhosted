import { afterEach, describe, expect, test } from 'bun:test';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { appContract, opsContract, publicContract } from '@webperf/contracts';
import { controlContract } from '@webperf/contracts/control-contract';
import type { CheckProfileReportResponse } from '@webperf/contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type MockProbeScenario = {
  latencyMs: number;
  statusCode: number;
  success?: boolean;
  error?: string | null;
};

const tempDirs: string[] = [];
const startedServers: Array<{ stop: (closeActiveConnections?: boolean) => void }> = [];

afterEach(() => {
  for (const server of startedServers.splice(0)) {
    server.stop(true);
  }

  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();

    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe('api service monitoring expansion', () => {
  test(
    'replays custom request config, evaluates latency thresholds, and marks uptime failures',
    async () => {
      const probeRequests: unknown[] = [];
      const webhookPayloads: unknown[] = [];
      const probe = startProbeServer(
        {
          latencyMs: 650,
          statusCode: 200,
          success: true,
          error: null
        },
        probeRequests
      );
      const webhook = startWebhookServer(webhookPayloads);
      const harness = await startSelfhostHarness(probe.port);
      const client = createORPCClient(
        new RPCLink({
          url: `${harness.baseUrl}/rpc`
        })
      ) as ContractRouterClient<typeof controlContract>;
      const publicClient = createORPCClient(
        new RPCLink({
          url: `${harness.baseUrl}/rpc/public`
        })
      ) as ContractRouterClient<typeof publicContract>;
      const appClient = createORPCClient(
        new RPCLink({
          url: `${harness.baseUrl}/rpc/app`
        })
      ) as ContractRouterClient<typeof appContract>;
      const opsClient = createORPCClient(
        new RPCLink({
          url: `${harness.baseUrl}/rpc/ops`
        })
      ) as ContractRouterClient<typeof opsContract>;

      const health = await client.health();
      expect(health.service).toBe('webperf-api');
      expect(health.ok).toBe(true);
      expect((await opsClient.system.health()).service).toBe('webperf-api');
      expect((await appClient.system.regions()).regions.length).toBeGreaterThan(0);
      expect((await publicClient.capabilities.get()).deploymentModel).toBe('selfhost');

      const openApiResponse = await fetch(`${harness.baseUrl}/openapi/control.json`);
      expect(openApiResponse.ok).toBe(true);
      const openApi = await openApiResponse.json();
      expect(openApi.info?.title).toBe('Webperf Control API');
      expect(openApi.paths?.['/v1/jobs']).toBeTruthy();

      const publicOpenApiResponse = await fetch(`${harness.baseUrl}/openapi/public.json`);
      expect(publicOpenApiResponse.ok).toBe(true);
      const publicOpenApi = await publicOpenApiResponse.json();
      expect(publicOpenApi.info?.title).toBe('Webperf Public API');
      expect(publicOpenApi.paths?.['/v1/sites']).toBeTruthy();
      expect(publicOpenApi.paths?.['/v1/checks']).toBeTruthy();

      const property = await createProperty(harness.baseUrl);
      const routeSet = await createRouteSet(harness.baseUrl, property.id);
      const regionPack = await createRegionPack(harness.baseUrl);
      const thresholdProfile = await createCheckProfile(harness.baseUrl, {
        propertyId: property.id,
        routeSetId: routeSet.id,
        regionPackId: regionPack.id,
        monitorType: 'latency',
        latencyThresholdMs: 600,
        webhookUrl: webhook.url,
        scheduleIntervalMinutes: 5
      });

      const dispatchResponse = await fetch(
        `${harness.baseUrl}/v1/scheduler/dispatch?now=2099-01-01T00:00:00.000Z`,
        {
          method: 'POST'
        }
      );
      expect(dispatchResponse.ok).toBe(true);

      const thresholdReport = await waitForReport(
        harness.baseUrl,
        thresholdProfile.id,
        (candidate) => (candidate.latestRunSummary?.alertDeliveries.length ?? 0) > 0
      );

      expect(thresholdReport.latestRunSummary?.status).toBe('warning');
      expect(thresholdReport.latestRunSummary?.evaluation?.thresholdBreached).toBe(true);
      expect(thresholdReport.latestRunSummary?.evaluation?.failedChecks).toBe(0);
      expect(probeRequests).toHaveLength(1);
      expect(probeRequests[0]).toMatchObject({
        request: {
          method: 'POST',
          headers: [{ name: 'Authorization', value: 'Bearer staging-token' }],
          body: {
            mode: 'text',
            contentType: 'application/json',
            value: '{"release":"2026.04.12"}'
          }
        }
      });

      probe.setScenario({
        latencyMs: 120,
        statusCode: 404,
        success: true,
        error: null
      });

      const uptimeProfile = await createCheckProfile(harness.baseUrl, {
        propertyId: property.id,
        routeSetId: routeSet.id,
        regionPackId: regionPack.id,
        monitorType: 'uptime',
        latencyThresholdMs: null,
        webhookUrl: webhook.url
      });

      const runResponse = await fetch(`${harness.baseUrl}/v1/check-profiles/${uptimeProfile.id}/runs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: '{}'
      });
      expect(runResponse.ok).toBe(true);

      const uptimeReport = await waitForReport(
        harness.baseUrl,
        uptimeProfile.id,
        (candidate) =>
          candidate.latestRunSummary?.evaluation?.failedChecks === 1
          && (candidate.latestRunSummary?.alertDeliveries.length ?? 0) > 0
      );

      expect(uptimeReport.latestRunSummary?.status).toBe('failed');
      expect(uptimeReport.latestRunSummary?.evaluation?.monitorType).toBe('uptime');
      expect(uptimeReport.latestRunSummary?.evaluation?.failedChecks).toBe(1);
      expect(uptimeReport.latestRunSummary?.alertDeliveries.length).toBe(1);
      await waitForWebhookPayloads(webhookPayloads, 2);
      expect(webhookPayloads).toHaveLength(2);
    },
    15_000
  );
});

const createTempDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), 'webperf-api-http-'));
  tempDirs.push(directory);
  return directory;
};

const openPort = async () =>
  await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate port'));
        return;
      }

      resolve(address.port);
      server.close();
    });
  });

const startProbeServer = (scenario: MockProbeScenario, requests: unknown[]) => {
  const current = { ...scenario };
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname !== '/measure') {
        return new Response('not found', { status: 404 });
      }

      const payload = await request.json();
      requests.push(payload);

      return Response.json({
        measurement: {
          region: 'tokyo',
          url: payload.url,
          latencyMs: current.latencyMs,
          measuredAt: new Date().toISOString(),
          statusCode: current.statusCode,
          success: current.success ?? current.statusCode < 500,
          probeImpl: 'rust',
          finalUrl: payload.url,
          redirectCount: 0,
          timings: {
            totalMs: current.latencyMs,
            dnsMs: 12,
            tcpMs: 18,
            tlsMs: 25,
            ttfbMs: 80
          },
          tls: null,
          error: current.error ?? null
        }
      });
    }
  });

  startedServers.push(server);

  if (server.port == null) {
    throw new Error('Probe server did not expose a port');
  }

  return {
    port: server.port,
    setScenario(next: MockProbeScenario) {
      Object.assign(current, next);
    }
  };
};

const startWebhookServer = (payloads: unknown[]) => {
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      payloads.push(await request.json());
      return Response.json({ ok: true });
    }
  });

  startedServers.push(server);

  if (server.port == null) {
    throw new Error('Webhook server did not expose a port');
  }

  return {
    url: `http://127.0.0.1:${server.port}/webhook`
  };
};

const startSelfhostHarness = async (probePort: number) => {
  const controlPort = await openPort();
  const databaseDirectory = createTempDirectory();
  const databasePath = join(databaseDirectory, 'webperf.sqlite');
  process.env.SELFHOST_API_HOST = '127.0.0.1';
  process.env.SELFHOST_API_PORT = `${controlPort}`;
  process.env.SELFHOST_DATABASE_PATH = databasePath;
  process.env.PROBE_SHARED_SECRET = 'dev-shared-secret';
  process.env.SELFHOST_ACTIVE_REGION_CODES_JSON = '["tokyo"]';
  process.env.SELFHOST_REGION_IDS_JSON = '{"tokyo":"JP"}';
  process.env.SELFHOST_PROBE_BASE_URLS_JSON = `{"tokyo":"http://127.0.0.1:${probePort}"}`;
  process.env.SELFHOST_MAX_TARGET_ATTEMPTS = '1';

  const modulePath = new URL(`../src/index.ts?instance=${crypto.randomUUID()}`, import.meta.url).href;
  const module = (await import(modulePath)) as { server: { stop: (closeActiveConnections?: boolean) => void } };
  startedServers.push(module.server);

  const baseUrl = `http://127.0.0.1:${controlPort}`;
  await waitForHealth(baseUrl);

  return { baseUrl };
};

const waitForHealth = async (baseUrl: string) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);

      if (response.ok) {
        return;
      }
    } catch {
      // keep polling
    }

    await Bun.sleep(100);
  }

  throw new Error(`Timed out waiting for ${baseUrl}/health`);
};

const waitForReport = async (
  baseUrl: string,
  profileId: string,
  predicate: (report: CheckProfileReportResponse) => boolean
) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${baseUrl}/v1/check-profiles/${profileId}/report`);

    if (response.ok) {
      const report = (await response.json()) as CheckProfileReportResponse;

      if (predicate(report)) {
        return report;
      }
    }

    await Bun.sleep(100);
  }

  throw new Error(`Timed out waiting for report for ${profileId}`);
};

const waitForWebhookPayloads = async (payloads: unknown[], expectedLength: number) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (payloads.length >= expectedLength) {
      return;
    }

    await Bun.sleep(50);
  }

  throw new Error(`Timed out waiting for ${expectedLength} webhook payloads`);
};

const createProperty = async (baseUrl: string) => {
  const response = await fetch(`${baseUrl}/v1/properties`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      name: 'Main site',
      baseUrl: 'https://example.com'
    })
  });
  const payload = await response.json();
  expect(response.ok).toBe(true);
  return payload.property as { id: string };
};

const createRouteSet = async (baseUrl: string, propertyId: string) => {
  const response = await fetch(`${baseUrl}/v1/route-sets`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      propertyId,
      name: 'Core routes',
      routes: [{ label: 'Homepage', url: 'https://example.com' }]
    })
  });
  const payload = await response.json();
  expect(response.ok).toBe(true);
  return payload.routeSet as { id: string };
};

const createRegionPack = async (baseUrl: string) => {
  const response = await fetch(`${baseUrl}/v1/region-packs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      name: 'Core 1',
      regions: ['tokyo']
    })
  });
  const payload = await response.json();
  expect(response.ok).toBe(true);
  return payload.regionPack as { id: string };
};

const createCheckProfile = async (
  baseUrl: string,
  input: {
    propertyId: string;
    routeSetId: string;
    regionPackId: string;
    monitorType: 'latency' | 'uptime';
    latencyThresholdMs: number | null;
    webhookUrl: string;
    scheduleIntervalMinutes?: number;
  }
) => {
  const response = await fetch(`${baseUrl}/v1/check-profiles`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      propertyId: input.propertyId,
      routeSetId: input.routeSetId,
      regionPackId: input.regionPackId,
      name: `Profile ${input.monitorType}`,
      note: 'http integration test',
      request: {
        method: 'POST',
        headers: [{ name: 'Authorization', value: 'Bearer staging-token' }],
        body: {
          mode: 'text',
          contentType: 'application/json',
          value: '{"release":"2026.04.12"}'
        }
      },
      monitorPolicy: {
        monitorType: input.monitorType,
        successRule: 'status_2xx_3xx',
        latencyThresholdMs: input.latencyThresholdMs
      },
      alerts: {
        enabled: true,
        webhookTargets: [{ name: 'Primary', url: input.webhookUrl }],
        triggers: {
          onFailure: true,
          onLatencyThresholdBreach: true,
          onRegression: false
        }
      },
      scheduleIntervalMinutes: input.scheduleIntervalMinutes
    })
  });
  const payload = await response.json();
  expect(response.ok).toBe(true);
  return payload.profile as { id: string };
};
