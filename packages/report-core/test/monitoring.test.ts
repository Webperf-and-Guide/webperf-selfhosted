import { describe, expect, test } from 'bun:test';
import { buildCheckProfileReportCsv, evaluateMonitorTargets } from '../src/index';

describe('monitor evaluation', () => {
  test('marks threshold breaches as warnings when no failures exist', () => {
    const evaluation = evaluateMonitorTargets({
      monitorPolicy: {
        monitorType: 'latency',
        successRule: 'status_2xx_3xx',
        latencyThresholdMs: 400
      },
      targets: [
        {
          status: 'succeeded',
          statusCode: 200,
          latencyMs: 520,
          errorMessage: null
        }
      ]
    });

    expect(evaluation.status).toBe('warning');
    expect(evaluation.thresholdBreached).toBe(true);
    expect(evaluation.failedChecks).toBe(0);
  });

  test('marks 4xx outcomes as failures for uptime semantics', () => {
    const evaluation = evaluateMonitorTargets({
      monitorPolicy: {
        monitorType: 'uptime',
        successRule: 'status_2xx_3xx',
        latencyThresholdMs: null
      },
      targets: [
        {
          status: 'failed',
          statusCode: 404,
          latencyMs: 120,
          errorMessage: 'Status 404 did not satisfy status_2xx_3xx'
        }
      ]
    });

    expect(evaluation.status).toBe('failed');
    expect(evaluation.failedChecks).toBe(1);
    expect(evaluation.monitorType).toBe('uptime');
  });

  test('renders CSV rows for recent run summaries', () => {
    const csv = buildCheckProfileReportCsv({
      profile: {
        id: 'profile_1',
        propertyId: 'property_1',
        routeSetId: 'route_set_1',
        regionPackId: 'region_pack_1',
        name: 'Release gate',
        note: null,
        request: {
          method: 'GET',
          headers: [],
          body: null
        },
        monitorPolicy: {
          monitorType: 'latency',
          successRule: 'status_2xx_3xx',
          latencyThresholdMs: 400
        },
        alerts: {
          enabled: false,
          webhookTargets: [],
          triggers: {
            onFailure: true,
            onLatencyThresholdBreach: false,
            onRegression: false
          }
        },
        browserAuditPolicy: null,
        schedule: null,
        baseline: null,
        createdAt: '2026-04-12T00:00:00.000Z',
        updatedAt: '2026-04-12T00:00:00.000Z'
      },
      runs: [
        {
          runId: 'run_1',
          createdAt: '2026-04-12T00:05:00.000Z',
          trigger: 'manual',
          routeCount: 1,
          jobCount: 1,
          status: 'warning',
          evaluation: {
            monitorType: 'latency',
            successRule: 'status_2xx_3xx',
            status: 'warning',
            totalChecks: 1,
            healthyChecks: 1,
            failedChecks: 0,
            latencyThresholdMs: 400,
            thresholdBreached: true,
            thresholdBreachedCount: 1,
            worstLatencyMs: 520,
            regressionDetected: false,
            regressedCount: 0
          },
          alertDeliveries: [],
          baselinePinned: false
        }
      ]
    });

    expect(csv).toContain('profile_id,profile_name,run_id');
    expect(csv).toContain('profile_1,Release gate,run_1');
  });
});
