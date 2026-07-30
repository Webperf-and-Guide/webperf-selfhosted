import { describe, expect, test } from 'bun:test';
import { runtimeMetricsSchema } from '../src/runtime-metrics';

const fixture = {
  schemaVersion: 1,
  observedAt: '2026-07-30T00:00:00.000Z',
  runtimeLocation: {
    regionId: 'tokyo',
    label: 'Tokyo'
  },
  executions: {
    ready: 2,
    delayed: 1,
    active: 1,
    expiredLeases: 0,
    retryQueued: 1,
    exhausted: 0,
    oldestReadyAgeMs: 1_500,
    oldestActiveAgeMs: 500,
    byStatus: {
      queued: 3,
      leased: 0,
      running: 1,
      succeeded: 4,
      failed: 1,
      cancelled: 0
    },
    byKind: {
      network_probe: {
        queued: 3,
        leased: 0,
        running: 1,
        succeeded: 4,
        failed: 1,
        cancelled: 0
      },
      browser_audit: {
        queued: 0,
        leased: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0
      },
      webhook_delivery: {
        queued: 0,
        leased: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0
      }
    }
  },
  capacity: {
    topology: 'single-replica-sqlite',
    executorConcurrency: 1,
    horizontalScalingSafe: false
  },
  retention: {
    terminalCountsBoundedDays: 30
  }
} as const;

describe('runtime metrics contract', () => {
  test('accepts a provider-neutral execution snapshot', () => {
    expect(runtimeMetricsSchema.parse(fixture)).toEqual(fixture);
  });

  test('rejects negative queue pressure and a changed executor model', () => {
    expect(runtimeMetricsSchema.safeParse({
      ...fixture,
      executions: {
        ...fixture.executions,
        ready: -1
      }
    }).success).toBe(false);
    expect(runtimeMetricsSchema.safeParse({
      ...fixture,
      capacity: {
        ...fixture.capacity,
        executorConcurrency: 2
      }
    }).success).toBe(false);
  });
});
