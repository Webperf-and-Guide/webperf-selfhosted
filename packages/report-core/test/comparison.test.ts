import { describe, expect, test } from 'bun:test';
import type { CheckProfileRun, LatencyJobDetail } from '@webperf/contracts';
import { buildCheckProfileComparison } from '../src/index';

const createJob = ({
  id,
  latencyMs,
  statusCode,
  finalUrl,
  errorMessage
}: {
  id: string;
  latencyMs: number;
  statusCode: number;
  finalUrl: string;
  errorMessage: string | null;
}): LatencyJobDetail => ({
  id,
  url: 'https://example.com',
  status: errorMessage ? 'failed' : 'succeeded',
  note: 'Homepage',
  request: {
    method: 'GET',
    headers: [],
    body: null
  },
  monitorPolicy: {
    monitorType: 'latency',
    successRule: 'status_2xx_3xx',
    latencyThresholdMs: null
  },
  requestedAt: '2026-04-09T00:00:00.000Z',
  startedAt: '2026-04-09T00:00:01.000Z',
  completedAt: '2026-04-09T00:00:02.000Z',
  requesterIp: null,
  selectedRegions: ['tokyo'],
  targets: [
    {
      jobId: id,
      region: 'tokyo',
      status: errorMessage ? 'failed' : 'succeeded',
      attemptNo: 1,
      maxAttempts: 1,
      latencyMs,
      statusCode,
      success: !errorMessage,
      probeImpl: 'rust',
      measurement: {
        region: 'tokyo',
        url: 'https://example.com',
        latencyMs,
        measuredAt: '2026-04-09T00:00:02.000Z',
        statusCode,
        success: !errorMessage,
        probeImpl: 'rust',
        finalUrl,
        redirectCount: 0,
        timings: {
          totalMs: latencyMs,
          dnsMs: 10,
          tcpMs: 15,
          tlsMs: 20,
          ttfbMs: 40
        },
        tls: null,
        error: errorMessage
      },
      execution: {
        runnerType: 'network_probe',
        provider: 'selfhost',
        locationMode: 'best_effort',
        region: 'tokyo',
        city: null,
        runnerVersion: 'probe-rs'
      },
      slotId: null,
      errorCode: errorMessage ? 'probe_measurement_failed' : null,
      errorClass: errorMessage ? 'terminal' : null,
      errorMessage,
      startedAt: '2026-04-09T00:00:01.000Z',
      finishedAt: '2026-04-09T00:00:02.000Z',
      updatedAt: '2026-04-09T00:00:02.000Z'
    }
  ],
  summary: {
    total: 1,
    succeeded: errorMessage ? 0 : 1,
    failed: errorMessage ? 1 : 0,
    inflight: 0
  },
  evaluation: {
    monitorType: 'latency',
    successRule: 'status_2xx_3xx',
    status: errorMessage ? 'failed' : 'healthy',
    totalChecks: 1,
    healthyChecks: errorMessage ? 0 : 1,
    failedChecks: errorMessage ? 1 : 0,
    latencyThresholdMs: null,
    thresholdBreached: false,
    thresholdBreachedCount: 0,
    worstLatencyMs: latencyMs,
    regressionDetected: false,
    regressedCount: 0
  }
});

const createRun = (id: string, jobId: string): CheckProfileRun => ({
  id,
  profileId: 'profile_test',
  trigger: 'manual',
  createdAt: '2026-04-09T00:00:00.000Z',
  routeCount: 1,
  browserAuditSummary: null,
  evaluation: null,
  alertDeliveries: [],
  routes: [
    {
      routeId: 'route_home',
      routeLabel: 'Homepage',
      url: 'https://example.com',
      jobId,
      browserAudit: null
    }
  ]
});

describe('buildCheckProfileComparison', () => {
  test('includes latency, final url, impl, and error detail deltas', () => {
    const currentRun = createRun('run_current', 'job_current');
    const comparedRun = createRun('run_previous', 'job_previous');
    const currentJob = createJob({
      id: 'job_current',
      latencyMs: 110,
      statusCode: 200,
      finalUrl: 'https://example.com/home',
      errorMessage: null
    });
    const previousJob = createJob({
      id: 'job_previous',
      latencyMs: 180,
      statusCode: 200,
      finalUrl: 'https://example.com/old-home',
      errorMessage: 'timeout'
    });

    const comparison = buildCheckProfileComparison({
      currentRun,
      currentJobs: [currentJob],
      comparedRun,
      comparedJobs: [previousJob],
      mode: 'baseline'
    });

    expect(comparison.mode).toBe('baseline');
    expect(comparison.summary.improved).toBe(1);
    expect(comparison.summary.regressed).toBe(0);
    expect(comparison.routes[0]?.regions[0]).toMatchObject({
      classification: 'improved',
      currentFinalUrl: 'https://example.com/home',
      previousFinalUrl: 'https://example.com/old-home',
      currentProbeImpl: 'rust',
      previousProbeImpl: 'rust',
      currentErrorMessage: null,
      previousErrorMessage: 'timeout',
      latencyDeltaMs: -70
    });
  });
});
