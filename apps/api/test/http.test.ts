import { afterEach, describe, expect, test } from 'bun:test';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { BrowserAuditWorkerRequest } from '@webperf/contracts';
import { appContract, opsContract, publicContract } from '@webperf/contracts';
import { controlContract } from '@webperf/contracts/control-contract';
import type { CheckProfileReportResponse } from '@webperf/contracts';
import { createBrowserAuditSignature } from '@webperf/domain-core';
import { createBrowserAuditExecutionHandler } from '../../executor/src/browser-audit-handler';
import { createExecutorApiClient } from '../../executor/src/client';
import { createNetworkExecutionHandler } from '../../executor/src/network-handler';
import { processExecutionJob, type ExecutorLogger } from '../../executor/src/runner';
import { createWebhookExecutionHandler } from '../../executor/src/webhook-handler';
import { dispatchScheduledChecks } from '../../scheduler/src/scheduler';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JobRepository } from '../src/repository';

type MockProbeScenario = {
  latencyMs: number;
  statusCode: number;
  success?: boolean;
  error?: string | null;
};

type MockBrowserAuditScenario = {
  status: 'succeeded' | 'failed';
  error?: string | null;
};

const selfhostEnvKeys = [
  'SELFHOST_API_HOST',
  'SELFHOST_API_PORT',
  'SELFHOST_DATABASE_PATH',
  'SELFHOST_ARTIFACTS_PATH',
  'SELFHOST_ARTIFACT_UPLOAD_BASE_URL',
  'SELFHOST_MAX_ARTIFACT_BYTES',
  'SELFHOST_ARTIFACT_UPLOAD_TTL_SECONDS',
  'SELFHOST_ADMIN_TOKEN',
  'SELFHOST_ADMIN_TOKEN_NEXT',
  'SELFHOST_INTERNAL_SECRET',
  'SELFHOST_INTERNAL_SECRET_NEXT',
  'PROBE_SHARED_SECRET',
  'PROBE_SHARED_SECRET_NEXT',
  'SELFHOST_ACTIVE_REGION_CODES_JSON',
  'SELFHOST_REGION_IDS_JSON',
  'SELFHOST_PROBE_BASE_URLS_JSON',
  'SELFHOST_MAX_TARGET_ATTEMPTS',
  'BROWSER_AUDIT_SHARED_SECRET',
  'BROWSER_AUDIT_SHARED_SECRET_NEXT',
  'SELFHOST_BROWSER_AUDIT_BASE_URL'
] as const;

const testAdminToken = 'test-admin-token-keep-server-side';
const testInternalSecret = 'test-internal-secret-for-services';
const testProbeSecret = 'test-probe-shared-secret';
const defaultBrowserAuditSecret = 'test-browser-audit-shared-secret';
const nativeFetch = globalThis.fetch;
const apiCredentialsByOrigin = new Map<string, { adminToken: string; internalSecret: string }>();
const fetch = Object.assign((
  input: Parameters<typeof globalThis.fetch>[0],
  init?: Parameters<typeof globalThis.fetch>[1]
) => {
  const request = input instanceof Request ? new Request(input, init) : new Request(input, init);
  const url = new URL(request.url);
  const credentials = apiCredentialsByOrigin.get(url.origin);

  if (!credentials) {
    return nativeFetch(request);
  }

  const headers = new Headers(request.headers);
  const token = url.pathname === '/v1/scheduler/dispatch' || url.pathname.startsWith('/internal/')
    ? credentials.internalSecret
    : credentials.adminToken;
  headers.set('authorization', `Bearer ${token}`);
  return nativeFetch(new Request(request, { headers }));
}, { preconnect: nativeFetch.preconnect });

const tempDirs: string[] = [];
const startedServers: Array<{ stop: (closeActiveConnections?: boolean) => void }> = [];

afterEach(() => {
  apiCredentialsByOrigin.clear();
  for (const server of startedServers.splice(0)) {
    server.stop(true);
  }

  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();

    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  for (const key of selfhostEnvKeys) {
    delete process.env[key];
  }
});

describe('api service monitoring expansion', () => {
  test(
    'replays custom request config, evaluates latency thresholds, and marks uptime failures',
    async () => {
      const probeRequests: unknown[] = [];
      const webhookPayloads: unknown[] = [];
      const browserAuditRequests: BrowserAuditWorkerRequest[] = [];
      const probe = startProbeServer(
        {
          latencyMs: 650,
          statusCode: 200,
          success: true,
          error: null
        },
        probeRequests
      );
      const browserAuditWorker = startBrowserAuditWorkerServer(
        {
          status: 'succeeded'
        },
        browserAuditRequests
      );
      const browserAuditExecutor = {
        baseUrl: `http://127.0.0.1:${browserAuditWorker.port}`,
        sharedSecret: 'browser-audit-secret'
      };
      const webhook = startWebhookServer(webhookPayloads);
      const harness = await startSelfhostHarness(probe.port, {
        browserAuditBaseUrl: browserAuditExecutor.baseUrl
      });
      const client = createORPCClient(
        new RPCLink({
          url: `${harness.baseUrl}/rpc`,
          fetch
        })
      ) as ContractRouterClient<typeof controlContract>;
      const publicClient = createORPCClient(
        new RPCLink({
          url: `${harness.baseUrl}/rpc/public`,
          fetch
        })
      ) as ContractRouterClient<typeof publicContract>;
      const appClient = createORPCClient(
        new RPCLink({
          url: `${harness.baseUrl}/rpc/app`,
          fetch
        })
      ) as ContractRouterClient<typeof appContract>;
      const opsClient = createORPCClient(
        new RPCLink({
          url: `${harness.baseUrl}/rpc/ops`,
          fetch
        })
      ) as ContractRouterClient<typeof opsContract>;

      const health = await client.health();
      expect(health.service).toBe('webperf-api');
      expect(health.ok).toBe(true);
      expect((await opsClient.system.health()).service).toBe('webperf-api');
      expect((await appClient.system.regions()).regions.length).toBeGreaterThan(0);
      expect((await publicClient.capabilities.get()).deploymentModel).toBe('selfhost');
      expect((await publicClient.capabilities.get()).features.browserAuditDirectRun).toBe(true);
      expect((await publicClient.capabilities.get()).metrics.networkProbe).toEqual({
        version: 'v1',
        dnsTiming: true,
        tcpTiming: false,
        tlsTiming: false,
        responseHeaderTiming: true,
        bodySampleTiming: false,
        tlsMetadata: false
      });

      const unauthorizedSitesResponse = await nativeFetch(`${harness.baseUrl}/v1/sites`);
      expect(unauthorizedSitesResponse.status).toBe(401);
      expect(unauthorizedSitesResponse.headers.get('www-authenticate')).toContain('Bearer');
      expect((await nativeFetch(`${harness.baseUrl}/v1/capabilities`)).status).toBe(200);
      const publicHealth = await (await nativeFetch(`${harness.baseUrl}/health`)).json();
      expect(publicHealth).toEqual({ service: 'webperf-api', ok: true });
      expect((await nativeFetch(`${harness.baseUrl}/openapi/public.json`)).status).toBe(200);
      expect((await nativeFetch(`${harness.baseUrl}/openapi/control.json`)).status).toBe(401);
      const oversizedJsonResponse = await fetch(`${harness.baseUrl}/v1/browser-audits`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify('x'.repeat(1_024 * 1_024))
      });
      expect(oversizedJsonResponse.status).toBe(413);
      expect((await oversizedJsonResponse.json()).error).toContain('1048576 bytes');
      expect(
        (
          await nativeFetch(`${harness.baseUrl}/v1/scheduler/dispatch`, {
            method: 'POST',
            headers: { authorization: `Bearer ${testAdminToken}` }
          })
        ).status
      ).toBe(401);

      harness.repository.enqueueExecutionJob({
        id: 'exec_http_transport',
        kind: 'network_probe',
        resourceId: 'job_http_transport',
        maxAttempts: 3,
        payload: {
          jobId: 'job_http_transport',
          headers: [{ name: 'Authorization', value: 'Bearer executor-needs-this-value' }]
        }
      });
      expect(
        (
          await nativeFetch(`${harness.baseUrl}/internal/execution-jobs/claim`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ leaseOwner: 'executor-http', leaseDurationMs: 60_000 })
          })
        ).status
      ).toBe(401);
      expect(
        (
          await nativeFetch(`${harness.baseUrl}/internal/execution-jobs/claim`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${testAdminToken}`,
              'content-type': 'application/json'
            },
            body: JSON.stringify({ leaseOwner: 'executor-http', leaseDurationMs: 60_000 })
          })
        ).status
      ).toBe(401);

      const claimResponse = await fetch(`${harness.baseUrl}/internal/execution-jobs/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leaseOwner: 'executor-http', leaseDurationMs: 60_000 })
      });
      expect(claimResponse.status).toBe(200);
      expect(claimResponse.headers.get('cache-control')).toBe('no-store');
      const claimedExecution = await claimResponse.json();
      expect(claimedExecution.status).toBe('leased');
      expect(claimedExecution.payload.headers[0].value).toBe(
        'Bearer executor-needs-this-value'
      );

      const startExecutionResponse = await fetch(
        `${harness.baseUrl}/internal/execution-jobs/exec_http_transport/start`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ leaseOwner: 'executor-http', leaseDurationMs: 60_000 })
        }
      );
      expect(startExecutionResponse.status).toBe(200);
      expect((await startExecutionResponse.json()).status).toBe('running');

      const nonBrowserGrantResponse = await fetch(
        `${harness.baseUrl}/internal/execution-jobs/exec_http_transport/artifact-upload-grant`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ leaseOwner: 'executor-http' })
        }
      );
      expect(nonBrowserGrantResponse.status).toBe(409);
      expect(nonBrowserGrantResponse.headers.get('cache-control')).toBe('no-store');

      const staleCompletionResponse = await fetch(
        `${harness.baseUrl}/internal/execution-jobs/exec_http_transport/complete`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ leaseOwner: 'executor-stale' })
        }
      );
      expect(staleCompletionResponse.status).toBe(409);

      const completeExecutionResponse = await fetch(
        `${harness.baseUrl}/internal/execution-jobs/exec_http_transport/complete`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ leaseOwner: 'executor-http' })
        }
      );
      expect(completeExecutionResponse.status).toBe(200);
      expect((await completeExecutionResponse.json()).status).toBe('succeeded');

      const invalidExecutionIdResponse = await fetch(
        `${harness.baseUrl}/internal/execution-jobs/%25invalid/complete`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ leaseOwner: 'executor-http' })
        }
      );
      expect(invalidExecutionIdResponse.status).toBe(400);
      expect(invalidExecutionIdResponse.headers.get('cache-control')).toBe('no-store');

      const originalClaimExecutionJob = harness.repository.claimExecutionJob;
      harness.repository.claimExecutionJob = () => {
        throw new Error('raw-sensitive-repository-error');
      };
      let failedTransportResponse: Response;

      try {
        failedTransportResponse = await fetch(
          `${harness.baseUrl}/internal/execution-jobs/claim`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ leaseOwner: 'executor-http', leaseDurationMs: 60_000 })
          }
        );
      } finally {
        harness.repository.claimExecutionJob = originalClaimExecutionJob;
      }

      expect(failedTransportResponse.status).toBe(500);
      expect(failedTransportResponse.headers.get('cache-control')).toBe('no-store');
      const failedTransportBody = await failedTransportResponse.json();
      expect(failedTransportBody.incidentId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
      expect(JSON.stringify(failedTransportBody)).not.toContain('raw-sensitive-repository-error');

      const originalCreateExecutionResource = harness.repository.createExecutionResource;
      harness.repository.createExecutionResource = () => {
        throw new Error('raw-sensitive-job-queue-error');
      };
      let failedJobResponse: Response;

      try {
        failedJobResponse = await fetch(`${harness.baseUrl}/v1/jobs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            url: 'https://example.com/',
            regions: ['tokyo']
          })
        });
      } finally {
        harness.repository.createExecutionResource = originalCreateExecutionResource;
      }

      expect(failedJobResponse.status).toBe(500);
      const failedJobBody = await failedJobResponse.json();
      expect(failedJobBody).toMatchObject({ error: 'Failed to queue job' });
      expect(failedJobBody.incidentId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
      expect(JSON.stringify(failedJobBody)).not.toContain('raw-sensitive-job-queue-error');

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
      const maskedWebhookSecretResponse = await postCheckProfile(harness.baseUrl, {
        propertyId: property.id,
        routeSetId: routeSet.id,
        regionPackId: regionPack.id,
        monitorType: 'latency',
        latencyThresholdMs: 600,
        webhookUrl: webhook.url,
        webhookSecret: '[REDACTED]',
        name: 'Reject masked webhook secret'
      });
      expect(maskedWebhookSecretResponse.status).toBe(400);
      expect(await maskedWebhookSecretResponse.json()).toEqual({
        error: 'A new webhook secret cannot use [REDACTED] as its value'
      });

      const thresholdProfile = await createCheckProfile(harness.baseUrl, {
        propertyId: property.id,
        routeSetId: routeSet.id,
        regionPackId: regionPack.id,
        monitorType: 'latency',
        latencyThresholdMs: 600,
        webhookUrl: webhook.url,
        scheduleIntervalMinutes: 5
      });

      const scheduledProfile = harness.repository.getCheckProfile(thresholdProfile.id)!;
      harness.repository.saveCheckProfile({
        ...scheduledProfile,
        schedule: scheduledProfile.schedule
          ? { ...scheduledProfile.schedule, nextRunAt: '2000-01-01T00:00:00.000Z' }
          : null
      });
      const dispatchResult = await dispatchScheduledChecks({
        apiBaseUrl: harness.baseUrl,
        internalSecret: testInternalSecret,
        fetchImpl: nativeFetch
      });
      expect(dispatchResult.payload.triggeredCount).toBe(1);
      expect(dispatchResult.createdJobCount).toBe(1);
      await drainExecutions(harness.baseUrl, probe.port);

      const thresholdReport = await waitForReport(
        harness.baseUrl,
        thresholdProfile.id,
        (candidate) => (candidate.latestRunSummary?.alertDeliveries.length ?? 0) > 0
      );

      expect(thresholdReport.latestRunSummary?.status).toBe('warning');
      expect(thresholdReport.latestRunSummary?.evaluation?.thresholdBreached).toBe(true);
      expect(thresholdReport.latestRunSummary?.evaluation?.failedChecks).toBe(0);
      expect(thresholdReport.profile.request?.headers[0]?.value).toBe('[REDACTED]');
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
      await drainExecutions(harness.baseUrl, probe.port);

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

      const browserAuditCreateResponse = await fetch(`${harness.baseUrl}/v1/browser-audits`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          targetUrl: 'https://example.com',
          region: 'tokyo',
          policy: {
            preset: 'mobile',
            flow: {
              steps: [{ type: 'navigate', url: 'https://example.com' }]
            }
          },
          customHeaders: [{ name: 'Authorization', value: 'Bearer smoke-token' }],
          cookies: [{ name: 'session', value: 'cookie-value', domain: 'example.com', path: '/' }]
        })
      });
      const createdBrowserAudit = await browserAuditCreateResponse.json() as {
        id: string;
        status: string;
        error: string | null;
        result: { scores: { performance: number | null }; artifacts: Array<{ kind: string }> } | null;
        customHeaders: Array<{ name: string; value: string }>;
        cookies: Array<{ name: string; value: string }>;
      };
      expect(browserAuditCreateResponse.status).toBe(202);
      expect(createdBrowserAudit.status).toBe('queued');
      expect(createdBrowserAudit.error).toBeNull();
      expect(createdBrowserAudit.result).toBeNull();
      expect(createdBrowserAudit.customHeaders[0]?.value).toBe('[REDACTED]');
      expect(createdBrowserAudit.cookies[0]?.value).toBe('[REDACTED]');
      expect(browserAuditRequests).toHaveLength(0);

      await drainExecutions(harness.baseUrl, probe.port, browserAuditExecutor);

      expect(browserAuditRequests).toHaveLength(1);
      expect(browserAuditRequests[0]?.customHeaders[0]?.value).toBe('Bearer smoke-token');
      expect(browserAuditRequests[0]?.cookies[0]?.value).toBe('cookie-value');
      expect(browserAuditRequests[0]?.signature).not.toBe('pending');
      const expectedSignature = await createBrowserAuditSignature(
        'browser-audit-secret',
        browserAuditRequests[0] as BrowserAuditWorkerRequest
      );
      expect(browserAuditRequests[0]?.signature).toBe(expectedSignature);

      const browserAuditListResponse = await fetch(`${harness.baseUrl}/v1/browser-audits?pageSize=10`);
      const browserAuditListPayload = await browserAuditListResponse.json() as {
        browserAudits: Array<{ id: string; status: string }>;
        pageInfo: { totalCount: number; pageSize: number };
      };
      expect(browserAuditListResponse.status).toBe(200);
      expect(browserAuditListPayload.pageInfo.totalCount).toBe(1);
      expect(browserAuditListPayload.browserAudits[0]?.id).toBe(createdBrowserAudit.id);

      const browserAuditGetResponse = await fetch(`${harness.baseUrl}/v1/browser-audits/${createdBrowserAudit.id}`);
      const browserAuditDetail = await browserAuditGetResponse.json() as {
        id: string;
        status: string;
        result: {
          scores: { performance: number | null };
          artifacts: Array<{
            id: string;
            kind: string;
            url: string;
            filename: string;
            contentType: string;
            byteSize: number;
            sha256: string;
          }>;
        } | null;
      };
      expect(browserAuditGetResponse.status).toBe(200);
      expect(browserAuditDetail.id).toBe(createdBrowserAudit.id);
      expect(browserAuditDetail.status).toBe('succeeded');
      expect(browserAuditDetail.result?.scores.performance).toBe(0.91);
      expect(
        browserAuditDetail.result?.artifacts.some(
          (artifact) => artifact.kind === 'lighthouse-html'
        )
      ).toBe(true);
      const htmlArtifact = browserAuditDetail.result?.artifacts.find(
        (artifact) => artifact.kind === 'lighthouse-html'
      );
      if (!htmlArtifact) {
        throw new Error('Expected a persisted Lighthouse HTML artifact');
      }
      expect(htmlArtifact.url).toBe(
        `/v1/browser-audits/${createdBrowserAudit.id}/artifacts/${htmlArtifact.id}`
      );
      expect(htmlArtifact.filename).toBe(`${createdBrowserAudit.id}.html`);
      expect(htmlArtifact.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect((await nativeFetch(`${harness.baseUrl}${htmlArtifact.url}`)).status).toBe(401);
      const artifactDownload = await fetch(`${harness.baseUrl}${htmlArtifact.url}`);
      expect(artifactDownload.status).toBe(200);
      expect(artifactDownload.headers.get('content-type')).toBe('text/html');
      expect(artifactDownload.headers.get('content-disposition')).toContain(
        `filename="${createdBrowserAudit.id}.html"`
      );
      expect(await artifactDownload.text()).toContain(`<title>${createdBrowserAudit.id}</title>`);
      const jsonArtifact = browserAuditDetail.result?.artifacts.find(
        (artifact) => artifact.kind === 'lighthouse-json'
      );
      if (!jsonArtifact) {
        throw new Error('Expected a persisted Lighthouse JSON artifact');
      }
      const jsonArtifactDownload = await fetch(`${harness.baseUrl}${jsonArtifact.url}`);
      const expectedJsonArtifact = JSON.stringify({
        executionId: createdBrowserAudit.id,
        score: 0.91
      });
      expect(jsonArtifact.byteSize)
        .toBe(new TextEncoder().encode(expectedJsonArtifact).byteLength);
      expect(jsonArtifactDownload.headers.get('x-webperf-artifact-bytes'))
        .toBe(String(new TextEncoder().encode(expectedJsonArtifact).byteLength));
      expect(await jsonArtifactDownload.text()).toBe(expectedJsonArtifact);

      browserAuditWorker.setScenario({
        status: 'failed',
        error: 'Lighthouse run failed'
      });

      const failedBrowserAuditResponse = await fetch(`${harness.baseUrl}/v1/browser-audits`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          targetUrl: 'https://example.com/failure',
          policy: {
            preset: 'desktop',
            flow: {
              steps: [{ type: 'navigate', url: 'https://example.com/failure' }]
            }
          }
        })
      });
      const failedBrowserAudit = await failedBrowserAuditResponse.json() as {
        id: string;
        status: string;
        error: string | null;
        result: unknown;
      };
      expect(failedBrowserAuditResponse.status).toBe(202);
      expect(failedBrowserAudit.status).toBe('queued');
      expect(failedBrowserAudit.error).toBeNull();
      expect(failedBrowserAudit.result).toBeNull();

      await drainExecutions(harness.baseUrl, probe.port, browserAuditExecutor);
      const failedBrowserAuditDetail = await (
        await fetch(`${harness.baseUrl}/v1/browser-audits/${failedBrowserAudit.id}`)
      ).json() as {
        status: string;
        error: string | null;
        result: unknown;
      };
      expect(failedBrowserAuditDetail.status).toBe('failed');
      expect(failedBrowserAuditDetail.error).toBe('Lighthouse run failed');
      expect(failedBrowserAuditDetail.result).toBeNull();

      const failedBrowserAuditListResponse = await fetch(`${harness.baseUrl}/v1/browser-audits?pageSize=10`);
      const failedBrowserAuditListPayload = await failedBrowserAuditListResponse.json() as {
        browserAudits: Array<{ id: string; status: string; error: string | null }>;
        pageInfo: { totalCount: number };
      };
      expect(failedBrowserAuditListResponse.status).toBe(200);
      expect(failedBrowserAuditListPayload.pageInfo.totalCount).toBe(2);
      expect(failedBrowserAuditListPayload.browserAudits.some((audit) => audit.id === failedBrowserAudit.id && audit.status === 'failed')).toBe(true);
      const checksPageResponse = await fetch(`${harness.baseUrl}/v1/checks?pageSize=1`);
      const checksPagePayload = await checksPageResponse.json() as {
        checks: Array<{ id: string; name: string }>;
        pageInfo: { totalCount: number; pageSize: number; nextPageToken: string | null; filter: string | null };
      };
      expect(checksPageResponse.status).toBe(200);
      expect(checksPagePayload.pageInfo.totalCount).toBe(2);
      expect(checksPagePayload.pageInfo.pageSize).toBe(1);
      expect(checksPagePayload.pageInfo.nextPageToken).not.toBeNull();

      const filteredChecksResponse = await fetch(`${harness.baseUrl}/v1/checks?pageSize=5&filter=uptime`);
      const filteredChecksPayload = await filteredChecksResponse.json() as {
        checks: Array<{ id: string; name: string }>;
        pageInfo: { totalCount: number; filter: string | null };
      };
      expect(filteredChecksResponse.status).toBe(200);
      expect(filteredChecksPayload.pageInfo.totalCount).toBe(1);
      expect(filteredChecksPayload.pageInfo.filter).toBe('uptime');
      expect(filteredChecksPayload.checks[0]?.name).toBe('Profile uptime');

      await runCheckProfile(harness.baseUrl, thresholdProfile.id);
      await drainExecutions(harness.baseUrl, probe.port);
      const runs = await waitForRuns(harness.baseUrl, thresholdProfile.id, 2);
      const latestRun = runs[0]!;
      const previousRun = runs[1]!;

      const checkRunsPageResponse = await fetch(`${harness.baseUrl}/v1/checks/${thresholdProfile.id}/runs?pageSize=1`);
      const checkRunsPagePayload = await checkRunsPageResponse.json() as {
        runs: Array<{ id: string; trigger: string }>;
        pageInfo: { totalCount: number; pageSize: number; nextPageToken: string | null; filter: string | null };
      };
      expect(checkRunsPageResponse.status).toBe(200);
      expect(checkRunsPagePayload.pageInfo.totalCount).toBe(2);
      expect(checkRunsPagePayload.pageInfo.pageSize).toBe(1);
      expect(checkRunsPagePayload.pageInfo.nextPageToken).not.toBeNull();

      const filteredCheckRunsResponse = await fetch(
        `${harness.baseUrl}/v1/checks/${thresholdProfile.id}/runs?pageSize=5&filter=${latestRun.id}`
      );
      const filteredCheckRunsPayload = await filteredCheckRunsResponse.json() as {
        runs: Array<{ id: string }>;
        pageInfo: { totalCount: number; filter: string | null };
      };
      expect(filteredCheckRunsResponse.status).toBe(200);
      expect(filteredCheckRunsPayload.pageInfo.totalCount).toBe(1);
      expect(filteredCheckRunsPayload.pageInfo.filter).toBe(latestRun.id);
      expect(filteredCheckRunsPayload.runs[0]?.id).toBe(latestRun.id);

      const runDetailResponse = await fetch(`${harness.baseUrl}/v1/runs/${latestRun.id}`);
      const runDetailPayload = await runDetailResponse.json() as {
        check: { id: string };
        run: { id: string };
        jobs: Array<{ id: string }>;
      };
      expect(runDetailResponse.status).toBe(200);
      expect(runDetailPayload.check.id).toBe(thresholdProfile.id);
      expect(runDetailPayload.run.id).toBe(latestRun.id);
      expect(runDetailPayload.jobs.length).toBeGreaterThan(0);

      const comparisonResponse = await fetch(`${harness.baseUrl}/v1/comparisons`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          checkId: thresholdProfile.id,
          runId: latestRun.id,
          target: { type: 'latest_previous' }
        })
      });
      const comparison = await comparisonResponse.json() as { id: string };
      expect(comparisonResponse.status).toBe(201);

      const customComparisonResponse = await fetch(`${harness.baseUrl}/v1/comparisons`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          checkId: thresholdProfile.id,
          runId: latestRun.id,
          target: { type: 'run', runId: previousRun.id }
        })
      });
      const customComparison = await customComparisonResponse.json() as { id: string };
      expect(customComparisonResponse.status).toBe(201);

      const comparisonsPageResponse = await fetch(`${harness.baseUrl}/v1/comparisons?pageSize=1`);
      const comparisonsPagePayload = await comparisonsPageResponse.json() as {
        comparisons: Array<{ id: string; mode: string }>;
        pageInfo: { totalCount: number; nextPageToken: string | null };
      };
      expect(comparisonsPageResponse.status).toBe(200);
      expect(comparisonsPagePayload.pageInfo.totalCount).toBe(2);
      expect(comparisonsPagePayload.pageInfo.nextPageToken).not.toBeNull();

      const filteredComparisonsResponse = await fetch(`${harness.baseUrl}/v1/comparisons?pageSize=5&filter=custom`);
      const filteredComparisonsPayload = await filteredComparisonsResponse.json() as {
        comparisons: Array<{ id: string; mode: string }>;
        pageInfo: { totalCount: number; filter: string | null };
      };
      expect(filteredComparisonsResponse.status).toBe(200);
      expect(filteredComparisonsPayload.pageInfo.totalCount).toBe(1);
      expect(filteredComparisonsPayload.pageInfo.filter).toBe('custom');
      expect(filteredComparisonsPayload.comparisons[0]?.id).toBe(customComparison.id);

      const exportJsonResponse = await fetch(`${harness.baseUrl}/v1/exports`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          source: { type: 'comparison', comparisonId: comparison.id },
          format: 'json'
        })
      });
      expect(exportJsonResponse.status).toBe(201);

      const exportCsvResponse = await fetch(`${harness.baseUrl}/v1/exports`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          source: { type: 'check_report', checkId: thresholdProfile.id },
          format: 'csv'
        })
      });
      expect(exportCsvResponse.status).toBe(201);

      const exportsPageResponse = await fetch(`${harness.baseUrl}/v1/exports?pageSize=1`);
      const exportsPagePayload = await exportsPageResponse.json() as {
        exports: Array<{ id: string; format: string }>;
        pageInfo: { totalCount: number; nextPageToken: string | null };
      };
      expect(exportsPageResponse.status).toBe(200);
      expect(exportsPagePayload.pageInfo.totalCount).toBe(2);
      expect(exportsPagePayload.pageInfo.nextPageToken).not.toBeNull();

      const filteredExportsResponse = await fetch(`${harness.baseUrl}/v1/exports?pageSize=5&filter=csv`);
      const filteredExportsPayload = await filteredExportsResponse.json() as {
        exports: Array<{ format: string }>;
        pageInfo: { totalCount: number; filter: string | null };
      };
      expect(filteredExportsResponse.status).toBe(200);
      expect(filteredExportsPayload.pageInfo.totalCount).toBe(1);
      expect(filteredExportsPayload.pageInfo.filter).toBe('csv');
      expect(filteredExportsPayload.exports[0]?.format).toBe('csv');

      const analysisFromComparisonResponse = await fetch(`${harness.baseUrl}/v1/analyses`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          source: { type: 'comparison', comparisonId: comparison.id },
          kind: 'regression_summary'
        })
      });
      expect(analysisFromComparisonResponse.status).toBe(201);

      const analysisFromRunResponse = await fetch(`${harness.baseUrl}/v1/analyses`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          source: { type: 'run', runId: latestRun.id, checkId: thresholdProfile.id },
          kind: 'regression_summary'
        })
      });
      expect(analysisFromRunResponse.status).toBe(201);

      const analysesPageResponse = await fetch(`${harness.baseUrl}/v1/analyses?pageSize=1`);
      const analysesPagePayload = await analysesPageResponse.json() as {
        analyses: Array<{ id: string; source: { type: string } }>;
        pageInfo: { totalCount: number; nextPageToken: string | null };
      };
      expect(analysesPageResponse.status).toBe(200);
      expect(analysesPagePayload.pageInfo.totalCount).toBe(2);
      expect(analysesPagePayload.pageInfo.nextPageToken).not.toBeNull();

      const filteredAnalysesResponse = await fetch(`${harness.baseUrl}/v1/analyses?pageSize=5&filter=run`);
      const filteredAnalysesPayload = await filteredAnalysesResponse.json() as {
        analyses: Array<{ source: { type: string } }>;
        pageInfo: { totalCount: number; filter: string | null };
      };
      expect(filteredAnalysesResponse.status).toBe(200);
      expect(filteredAnalysesPayload.pageInfo.totalCount).toBe(1);
      expect(filteredAnalysesPayload.pageInfo.filter).toBe('run');
      expect(filteredAnalysesPayload.analyses[0]?.source.type).toBe('run');

      const alphaAuditResponse = await fetch(`${harness.baseUrl}/v1/browser-audits`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          targetUrl: 'https://example.com/alpha',
          region: 'tokyo',
          policy: {
            preset: 'mobile',
            flow: {
              steps: [{ type: 'navigate', url: 'https://example.com/alpha' }]
            }
          }
        })
      });
      expect(alphaAuditResponse.status).toBe(202);

      const betaAuditResponse = await fetch(`${harness.baseUrl}/v1/browser-audits`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          targetUrl: 'https://example.com/beta',
          region: 'tokyo',
          policy: {
            preset: 'desktop',
            flow: {
              steps: [{ type: 'navigate', url: 'https://example.com/beta' }]
            }
          }
        })
      });
      expect(betaAuditResponse.status).toBe(202);

      const browserAuditsPageResponse = await fetch(`${harness.baseUrl}/v1/browser-audits?pageSize=1`);
      const browserAuditsPagePayload = await browserAuditsPageResponse.json() as {
        browserAudits: Array<{ id: string; targetUrl: string }>;
        pageInfo: { totalCount: number; nextPageToken: string | null };
      };
      expect(browserAuditsPageResponse.status).toBe(200);
      expect(browserAuditsPagePayload.pageInfo.totalCount).toBe(4);
      expect(browserAuditsPagePayload.pageInfo.nextPageToken).not.toBeNull();

      const filteredBrowserAuditsResponse = await fetch(`${harness.baseUrl}/v1/browser-audits?pageSize=5&filter=beta`);
      const filteredBrowserAuditsPayload = await filteredBrowserAuditsResponse.json() as {
        browserAudits: Array<{ targetUrl: string }>;
        pageInfo: { totalCount: number; filter: string | null };
      };
      expect(filteredBrowserAuditsResponse.status).toBe(200);
      expect(filteredBrowserAuditsPayload.pageInfo.totalCount).toBe(1);
      expect(filteredBrowserAuditsPayload.pageInfo.filter).toBe('beta');
      expect(filteredBrowserAuditsPayload.browserAudits[0]?.targetUrl).toBe('https://example.com/beta');

      const secondaryPropertyResponse = await fetch(`${harness.baseUrl}/v1/properties`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: 'Secondary site',
          baseUrl: 'https://secondary.example.com'
        })
      });
      const secondaryPropertyPayload = await secondaryPropertyResponse.json() as {
        property: { id: string; name: string };
      };
      expect(secondaryPropertyResponse.status).toBe(201);

      const secondaryRouteSetResponse = await fetch(`${harness.baseUrl}/v1/route-sets`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          propertyId: secondaryPropertyPayload.property.id,
          name: 'Secondary checkout',
          routes: [{ label: 'Checkout', url: 'https://secondary.example.com/checkout' }]
        })
      });
      expect(secondaryRouteSetResponse.status).toBe(201);

      const secondaryRegionPackResponse = await fetch(`${harness.baseUrl}/v1/region-packs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: 'Backup APAC',
          regions: ['tokyo']
        })
      });
      expect(secondaryRegionPackResponse.status).toBe(201);

      const propertiesPageResponse = await fetch(`${harness.baseUrl}/v1/properties?pageSize=1`);
      const propertiesPagePayload = await propertiesPageResponse.json() as {
        properties: Array<{ id: string; name: string }>;
        pageInfo: { totalCount: number; pageSize: number; nextPageToken: string | null };
      };
      expect(propertiesPageResponse.status).toBe(200);
      expect(propertiesPagePayload.pageInfo.totalCount).toBe(2);
      expect(propertiesPagePayload.pageInfo.pageSize).toBe(1);
      expect(propertiesPagePayload.pageInfo.nextPageToken).not.toBeNull();

      const filteredPropertiesResponse = await fetch(`${harness.baseUrl}/v1/properties?pageSize=5&filter=secondary`);
      const filteredPropertiesPayload = await filteredPropertiesResponse.json() as {
        properties: Array<{ name: string }>;
        pageInfo: { totalCount: number; filter: string | null };
      };
      expect(filteredPropertiesResponse.status).toBe(200);
      expect(filteredPropertiesPayload.pageInfo.totalCount).toBe(1);
      expect(filteredPropertiesPayload.pageInfo.filter).toBe('secondary');
      expect(filteredPropertiesPayload.properties[0]?.name).toBe('Secondary site');

      const routeSetsPageResponse = await fetch(`${harness.baseUrl}/v1/route-sets?pageSize=1`);
      const routeSetsPagePayload = await routeSetsPageResponse.json() as {
        routeSets: Array<{ id: string; name: string }>;
        pageInfo: { totalCount: number; pageSize: number; nextPageToken: string | null };
      };
      expect(routeSetsPageResponse.status).toBe(200);
      expect(routeSetsPagePayload.pageInfo.totalCount).toBe(2);
      expect(routeSetsPagePayload.pageInfo.pageSize).toBe(1);
      expect(routeSetsPagePayload.pageInfo.nextPageToken).not.toBeNull();

      const filteredRouteSetsResponse = await fetch(`${harness.baseUrl}/v1/route-sets?pageSize=5&filter=secondary`);
      const filteredRouteSetsPayload = await filteredRouteSetsResponse.json() as {
        routeSets: Array<{ name: string }>;
        pageInfo: { totalCount: number; filter: string | null };
      };
      expect(filteredRouteSetsResponse.status).toBe(200);
      expect(filteredRouteSetsPayload.pageInfo.totalCount).toBe(1);
      expect(filteredRouteSetsPayload.pageInfo.filter).toBe('secondary');
      expect(filteredRouteSetsPayload.routeSets[0]?.name).toBe('Secondary checkout');

      const regionPacksPageResponse = await fetch(`${harness.baseUrl}/v1/region-packs?pageSize=1`);
      const regionPacksPagePayload = await regionPacksPageResponse.json() as {
        regionPacks: Array<{ id: string; name: string }>;
        pageInfo: { totalCount: number; pageSize: number; nextPageToken: string | null };
      };
      expect(regionPacksPageResponse.status).toBe(200);
      expect(regionPacksPagePayload.pageInfo.totalCount).toBe(2);
      expect(regionPacksPagePayload.pageInfo.pageSize).toBe(1);
      expect(regionPacksPagePayload.pageInfo.nextPageToken).not.toBeNull();

      const filteredRegionPacksResponse = await fetch(`${harness.baseUrl}/v1/region-packs?pageSize=5&filter=backup`);
      const filteredRegionPacksPayload = await filteredRegionPacksResponse.json() as {
        regionPacks: Array<{ name: string }>;
        pageInfo: { totalCount: number; filter: string | null };
      };
      expect(filteredRegionPacksResponse.status).toBe(200);
      expect(filteredRegionPacksPayload.pageInfo.totalCount).toBe(1);
      expect(filteredRegionPacksPayload.pageInfo.filter).toBe('backup');
      expect(filteredRegionPacksPayload.regionPacks[0]?.name).toBe('Backup APAC');

      const compatibilityChecksResponse = await fetch(`${harness.baseUrl}/v1/check-profiles?pageSize=5&filter=uptime`);
      const compatibilityChecksPayload = await compatibilityChecksResponse.json() as {
        checkProfiles: Array<{ name: string }>;
        pageInfo: { totalCount: number; filter: string | null };
      };
      expect(compatibilityChecksResponse.status).toBe(200);
      expect(compatibilityChecksPayload.pageInfo.totalCount).toBe(1);
      expect(compatibilityChecksPayload.pageInfo.filter).toBe('uptime');
      expect(compatibilityChecksPayload.checkProfiles[0]?.name).toBe('Profile uptime');

      for (const [legacyPath, canonicalPath] of [
        ['/v1/properties', '/v1/sites'],
        ['/v1/route-sets', '/v1/route-groups'],
        ['/v1/region-packs', '/v1/region-sets'],
        ['/v1/check-profiles', '/v1/checks']
      ] as const) {
        const compatibilityResponse = await fetch(`${harness.baseUrl}${legacyPath}`);
        expect(compatibilityResponse.status).toBe(200);
        expect(compatibilityResponse.headers.get('deprecation')).toBe('true');
        expect(compatibilityResponse.headers.get('link')).toContain(canonicalPath);
        expect(compatibilityResponse.headers.get('warning')).toContain('Deprecated API path');
      }

      const canonicalSitesResponse = await fetch(`${harness.baseUrl}/v1/sites`);
      expect(canonicalSitesResponse.status).toBe(200);
      expect(canonicalSitesResponse.headers.get('deprecation')).toBeNull();

      const stabilizedPublicOpenApiResponse = await fetch(`${harness.baseUrl}/openapi/public.json`);
      const stabilizedPublicOpenApi = await stabilizedPublicOpenApiResponse.json() as {
        paths?: Record<string, unknown>;
      };
      expect(stabilizedPublicOpenApiResponse.status).toBe(200);
      expect(stabilizedPublicOpenApi.paths?.['/v1/comparisons']).toBeTruthy();
      expect(stabilizedPublicOpenApi.paths?.['/v1/exports']).toBeTruthy();
      expect(stabilizedPublicOpenApi.paths?.['/v1/analyses']).toBeTruthy();
      expect(stabilizedPublicOpenApi.paths?.['/v1/browser-audits']).toBeTruthy();
      expect(stabilizedPublicOpenApi.paths?.['/v1/capabilities']).toBeTruthy();
    },
    20_000
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

const startBrowserAuditWorkerServer = (
  scenario: MockBrowserAuditScenario,
  requests: BrowserAuditWorkerRequest[]
) => {
  const current = { ...scenario };
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === '/healthz') {
        return Response.json({ ok: true });
      }

      if (url.pathname === '/capabilities') {
        return Response.json({
          protocolVersion: 'v1',
          flowDslVersion: 'v1',
          artifactRegistryVersion: 'v1',
          toolchain: {
            engine: { id: 'lighthouse', version: '12.6.0' },
            browser: { name: 'Chrome', version: '136.0.0.0' },
            runtime: { name: 'Bun', version: '1.3.11' },
            components: [{ name: 'puppeteer-core', version: '24.7.1' }]
          },
          supportedCheckpointModes: ['navigation', 'snapshot', 'timespan'],
          supportedArtifactKinds: [
            'lighthouse-json',
            'lighthouse-html',
            'screenshot',
            'trace'
          ],
          unsupportedFeatures: [],
          limits: {
            maxSteps: 20,
            maxCheckpoints: 3,
            maxPages: 1,
            maxContexts: 1,
            maxArtifactBytes: 25_000_000,
            defaultTotalTimeoutMs: 120_000,
            defaultStepTimeoutMs: 10_000
          }
        });
      }

      if (url.pathname !== '/audit') {
        return new Response('not found', { status: 404 });
      }

      const payload = await request.json() as BrowserAuditWorkerRequest;
      requests.push(payload);

      const startedAt = new Date().toISOString();
      const completedAt = new Date(Date.now() + 250).toISOString();
      const artifactPayloads = current.status === 'succeeded'
        ? [
            {
              kind: 'lighthouse-json',
              filename: `${payload.executionId}.json`,
              contentType: 'application/json',
              body: JSON.stringify({ executionId: payload.executionId, score: 0.91 })
            },
            {
              kind: 'lighthouse-html',
              filename: `${payload.executionId}.html`,
              contentType: 'text/html',
              body: `<!doctype html><title>${payload.executionId}</title>`
            }
          ]
        : [];
      if (current.status === 'succeeded' && payload.artifactUpload) {
        const uploadPath = `${payload.artifactUpload.baseUrl}/internal/browser-audits/${payload.executionId}/artifacts`;
        const scopedHeaders = {
          authorization: `Bearer ${payload.artifactUpload.bearerToken}`,
          'content-type': 'application/json',
          'x-artifact-size': '0'
        };
        const negativeChecks = await Promise.all([
          nativeFetch(`${uploadPath}?kind=lighthouse-json&filename=report.json`, {
            method: 'POST',
            headers: {
              ...scopedHeaders,
              authorization: `${scopedHeaders.authorization}tampered`
            }
          }),
          nativeFetch(
            `${payload.artifactUpload.baseUrl}/internal/browser-audits/${payload.executionId}_other/artifacts?kind=lighthouse-json&filename=report.json`,
            { method: 'POST', headers: scopedHeaders }
          ),
          nativeFetch(`${uploadPath}?kind=lighthouse-json&filename=${encodeURIComponent('../report.json')}`, {
            method: 'POST',
            headers: scopedHeaders
          }),
          nativeFetch(`${uploadPath}?kind=lighthouse-json&filename=report.json`, {
            method: 'POST',
            headers: { ...scopedHeaders, 'content-type': 'text/html' }
          }),
          nativeFetch(`${uploadPath}?kind=lighthouse-json&filename=report.json`, {
            method: 'POST',
            headers: {
              ...scopedHeaders,
              'x-artifact-size': String(payload.artifactUpload.maxArtifactBytes + 1)
            }
          })
        ]);
        expect(negativeChecks.map((response) => response.status))
          .toEqual([401, 401, 400, 415, 413]);
      }
      const artifacts = await Promise.all(artifactPayloads.map(async (artifact) => {
        if (!payload.artifactUpload) {
          throw new Error('Expected a scoped artifact upload configuration');
        }

        const body = new TextEncoder().encode(artifact.body);
        const response = await nativeFetch(
          `${payload.artifactUpload.baseUrl}/internal/browser-audits/${payload.executionId}/artifacts?kind=${artifact.kind}&filename=${encodeURIComponent(artifact.filename)}`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${payload.artifactUpload.bearerToken}`,
              'content-type': artifact.contentType,
              'content-length': String(body.byteLength),
              'x-artifact-size': String(body.byteLength)
            },
            body
          }
        );

        if (!response.ok) {
          throw new Error(`Mock artifact upload failed: ${response.status} ${await response.text()}`);
        }

        return response.json();
      }));

      return Response.json({
        executionId: payload.executionId,
        status: current.status,
        result:
          current.status === 'succeeded'
            ? {
                coreMetrics: {
                  fcpMs: 1_120,
                  lcpMs: 1_820,
                  cls: 0.02,
                  inpMs: 145,
                  tbtMs: 88,
                  speedIndexMs: 1_540
                },
                scores: {
                  performance: 0.91,
                  accessibility: 0.96,
                  bestPractices: 0.89,
                  seo: 0.94
                },
                extendedMetrics: [],
                checkpoints: [{
                  id: 'navigation',
                  mode: 'navigation',
                  label: 'Navigation',
                  finalUrl: payload.targetUrl,
                  statusCode: 200,
                  coreMetrics: {
                    fcpMs: 1_120,
                    lcpMs: 1_820,
                    cls: 0.02,
                    inpMs: 145,
                    tbtMs: 88,
                    speedIndexMs: 1_540
                  },
                  scores: {
                    performance: 0.91,
                    accessibility: 0.96,
                    bestPractices: 0.89,
                    seo: 0.94
                  },
                  extendedMetrics: []
                }],
                issues: [],
                artifacts,
                toolchain: {
                  engine: { id: 'lighthouse', version: '12.6.0' },
                  browser: { name: 'Chrome', version: '136.0.0.0' },
                  runtime: { name: 'Bun', version: '1.3.11' },
                  components: [{ name: 'puppeteer-core', version: '24.7.1' }]
                },
                startedAt,
                completedAt
              }
            : null,
        error: current.status === 'failed' ? current.error ?? 'Browser audit failed' : null
      });
    }
  });

  startedServers.push(server);

  if (server.port == null) {
    throw new Error('Browser audit worker did not expose a port');
  }

  return {
    port: server.port,
    setScenario(next: MockBrowserAuditScenario) {
      Object.assign(current, next);
    }
  };
};

const startSelfhostHarness = async (
  probePort: number,
  options?: {
    browserAuditBaseUrl?: string;
  }
) => {
  const controlPort = await openPort();
  const databaseDirectory = createTempDirectory();
  const databasePath = join(databaseDirectory, 'webperf.sqlite');
  process.env.SELFHOST_API_HOST = '127.0.0.1';
  process.env.SELFHOST_API_PORT = `${controlPort}`;
  process.env.SELFHOST_DATABASE_PATH = databasePath;
  process.env.SELFHOST_ARTIFACTS_PATH = join(databaseDirectory, 'artifacts');
  process.env.SELFHOST_ADMIN_TOKEN = testAdminToken;
  process.env.SELFHOST_ADMIN_TOKEN_NEXT = '';
  process.env.SELFHOST_INTERNAL_SECRET = testInternalSecret;
  process.env.SELFHOST_INTERNAL_SECRET_NEXT = '';
  process.env.SELFHOST_ACTIVE_REGION_CODES_JSON = '["tokyo"]';
  process.env.SELFHOST_REGION_IDS_JSON = '{"tokyo":"JP"}';
  process.env.SELFHOST_PROBE_BASE_URLS_JSON = `{"tokyo":"http://127.0.0.1:${probePort}"}`;
  process.env.SELFHOST_MAX_TARGET_ATTEMPTS = '1';

  if (options?.browserAuditBaseUrl) {
    process.env.SELFHOST_BROWSER_AUDIT_BASE_URL = options.browserAuditBaseUrl;
  } else {
    delete process.env.SELFHOST_BROWSER_AUDIT_BASE_URL;
  }

  const baseUrl = `http://127.0.0.1:${controlPort}`;
  apiCredentialsByOrigin.set(baseUrl, {
    adminToken: testAdminToken,
    internalSecret: testInternalSecret
  });
  const modulePath = new URL(`../src/index.ts?instance=${crypto.randomUUID()}`, import.meta.url).href;
  const module = (await import(modulePath)) as {
    server: { stop: (closeActiveConnections?: boolean) => void };
    repository: JobRepository;
  };
  startedServers.push(module.server);

  await waitForHealth(baseUrl);

  return { baseUrl, repository: module.repository };
};

const waitForHealth = async (baseUrl: string) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
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

const drainExecutions = async (
  baseUrl: string,
  probePort: number,
  browserAudit?: { baseUrl: string; sharedSecret: string }
) => {
  const leaseOwner = `executor-http-${crypto.randomUUID()}`;
  const client = createExecutorApiClient({
    baseUrl,
    internalSecret: testInternalSecret
  });
  const networkHandler = createNetworkExecutionHandler({
    client,
    leaseOwner,
    probeSharedSecret: testProbeSecret,
    probeBaseUrls: { tokyo: `http://127.0.0.1:${probePort}` }
  });
  const webhookHandler = createWebhookExecutionHandler({
    client,
    leaseOwner,
    validateUrl: () => {},
    // The integration receiver is loopback-only; production uses the executor's
    // DNS-pinned public-network transport instead of this local test adapter.
    requestImpl: async (url, init) => fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: init.signal,
      redirect: 'manual'
    })
  });
  const browserAuditHandler = createBrowserAuditExecutionHandler({
    client,
    leaseOwner,
    browserAuditSharedSecret: browserAudit?.sharedSecret ?? defaultBrowserAuditSecret,
    ...(browserAudit ? { browserAuditBaseUrl: browserAudit.baseUrl } : {})
  });
  const logger: ExecutorLogger = {
    info: () => {},
    error: () => {}
  };

  while (true) {
    const executionJob = await client.claim({ leaseOwner, leaseDurationMs: 60_000 });

    if (!executionJob) {
      return;
    }

    await processExecutionJob({
      client,
      handler: async (job, signal) => {
        if (job.kind === 'network_probe') {
          await networkHandler(job, signal);
          return;
        }

        if (job.kind === 'webhook_delivery') {
          await webhookHandler(job, signal);
          return;
        }

        if (job.kind === 'browser_audit') {
          await browserAuditHandler(job, signal);
          return;
        }

        throw new Error('Unexpected execution kind in network test drain');
      },
      executionJob,
      lease: { leaseOwner, leaseDurationMs: 60_000 },
      heartbeatIntervalMs: 20_000,
      maxExecutionMs: 60_000,
      logger
    });
  }
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

type CheckProfileTestInput = {
  propertyId: string;
  routeSetId: string;
  regionPackId: string;
  monitorType: 'latency' | 'uptime';
  latencyThresholdMs: number | null;
  webhookUrl: string;
  webhookSecret?: string;
  scheduleIntervalMinutes?: number;
  name?: string;
  note?: string;
};

const postCheckProfile = async (baseUrl: string, input: CheckProfileTestInput) =>
  fetch(`${baseUrl}/v1/check-profiles`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      propertyId: input.propertyId,
      routeSetId: input.routeSetId,
      regionPackId: input.regionPackId,
      name: input.name ?? `Profile ${input.monitorType}`,
      note: input.note ?? 'http integration test',
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
        webhookTargets: [{
          name: 'Primary',
          url: input.webhookUrl,
          secret: input.webhookSecret
        }],
        triggers: {
          onFailure: true,
          onLatencyThresholdBreach: true,
          onRegression: false
        }
      },
      scheduleIntervalMinutes: input.scheduleIntervalMinutes
    })
  });

const createCheckProfile = async (baseUrl: string, input: CheckProfileTestInput) => {
  const response = await postCheckProfile(baseUrl, input);
  const payload = await response.json();
  expect(response.ok).toBe(true);
  return payload.profile as { id: string };
};

const runCheckProfile = async (baseUrl: string, profileId: string) => {
  const response = await fetch(`${baseUrl}/v1/check-profiles/${profileId}/runs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: '{}'
  });

  expect(response.ok).toBe(true);
};

const waitForRuns = async (baseUrl: string, profileId: string, expectedLength: number) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${baseUrl}/v1/check-profiles/${profileId}/runs?pageSize=10`);

    if (response.ok) {
      const payload = await response.json() as {
        runs: Array<{ id: string; profileId: string }>;
      };

      if (payload.runs.length >= expectedLength) {
        return payload.runs;
      }
    }

    await Bun.sleep(100);
  }

  throw new Error(`Timed out waiting for ${expectedLength} runs for ${profileId}`);
};
