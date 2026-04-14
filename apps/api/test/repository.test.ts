import { afterEach, describe, expect, test } from 'bun:test';
import type { CheckProfile, CheckProfileRun, LatencyJobDetail, Property, RegionPack, RouteSet } from '@webperf/contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteJobRepository } from '../src/repository';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();

    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

const createTempDatabasePath = () => {
  const directory = mkdtempSync(join(tmpdir(), 'webperf-api-'));
  tempDirs.push(directory);
  return join(directory, 'webperf.sqlite');
};

const createJob = (overrides: Partial<LatencyJobDetail> = {}): LatencyJobDetail => ({
  id: 'job_test',
  url: 'https://example.com',
  status: 'succeeded',
  note: null,
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
  requestedAt: '2026-04-08T00:00:00.000Z',
  startedAt: '2026-04-08T00:00:01.000Z',
  completedAt: '2026-04-08T00:00:05.000Z',
  requesterIp: '127.0.0.1',
  selectedRegions: ['tokyo'],
  targets: [
    {
      jobId: 'job_test',
      region: 'tokyo',
      status: 'succeeded',
      attemptNo: 1,
      maxAttempts: 1,
      latencyMs: 123,
      statusCode: 200,
      success: true,
      probeImpl: 'rust',
      measurement: {
        region: 'tokyo',
        url: 'https://example.com',
        latencyMs: 123,
        measuredAt: '2026-04-08T00:00:05.000Z',
        statusCode: 200,
        success: true,
        probeImpl: 'rust',
        finalUrl: 'https://example.com',
        redirectCount: 0,
        timings: {
          totalMs: 123,
          dnsMs: 12,
          tcpMs: 20,
          tlsMs: 35,
          ttfbMs: 60
        },
        tls: {
          version: 'TLSv1.3',
          alpn: 'h2',
          cipherSuite: 'TLS_AES_128_GCM_SHA256',
          serverName: 'example.com'
        },
        error: null
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
      errorCode: null,
      errorClass: null,
      errorMessage: null,
      startedAt: '2026-04-08T00:00:01.000Z',
      finishedAt: '2026-04-08T00:00:05.000Z',
      updatedAt: '2026-04-08T00:00:05.000Z'
    }
  ],
  summary: {
    total: 1,
    succeeded: 1,
    failed: 0,
    inflight: 0
  },
  evaluation: {
    monitorType: 'latency',
    successRule: 'status_2xx_3xx',
    status: 'healthy',
    totalChecks: 1,
    healthyChecks: 1,
    failedChecks: 0,
    latencyThresholdMs: null,
    thresholdBreached: false,
    thresholdBreachedCount: 0,
    worstLatencyMs: 123,
    regressionDetected: false,
    regressedCount: 0
  },
  ...overrides
});

const createProperty = (overrides: Partial<Property> = {}): Property => ({
  id: 'property_test',
  name: 'Main site',
  baseUrl: 'https://example.com',
  createdAt: '2026-04-08T00:00:00.000Z',
  updatedAt: '2026-04-08T00:00:00.000Z',
  ...overrides
});

const createRouteSet = (overrides: Partial<RouteSet> = {}): RouteSet => ({
  id: 'routeset_test',
  propertyId: 'property_test',
  name: 'Core pages',
  routes: [
    {
      id: 'route_home',
      label: 'Homepage',
      url: 'https://example.com'
    }
  ],
  createdAt: '2026-04-08T00:00:00.000Z',
  updatedAt: '2026-04-08T00:00:00.000Z',
  ...overrides
});

const createRegionPack = (overrides: Partial<RegionPack> = {}): RegionPack => ({
  id: 'regionpack_test',
  name: 'Core 2',
  regions: ['tokyo', 'singapore'],
  createdAt: '2026-04-08T00:00:00.000Z',
  updatedAt: '2026-04-08T00:00:00.000Z',
  ...overrides
});

const createCheckProfile = (overrides: Partial<CheckProfile> = {}): CheckProfile => ({
  id: 'profile_test',
  propertyId: 'property_test',
  routeSetId: 'routeset_test',
  regionPackId: 'regionpack_test',
  name: 'Release gate',
  note: 'critical pages',
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
  alerts: {
    enabled: false,
    webhookTargets: [],
    triggers: {
      onFailure: true,
      onLatencyThresholdBreach: false,
      onRegression: false
    }
  },
  schedule: null,
  baseline: null,
  createdAt: '2026-04-08T00:00:00.000Z',
  updatedAt: '2026-04-08T00:00:00.000Z',
  ...overrides
});

const createCheckProfileRun = (overrides: Partial<CheckProfileRun> = {}): CheckProfileRun => ({
  id: 'run_test',
  profileId: 'profile_test',
  trigger: 'manual',
  createdAt: '2026-04-08T00:05:00.000Z',
  routeCount: 1,
  evaluation: null,
  alertDeliveries: [],
  routes: [
    {
      routeId: 'route_home',
      routeLabel: 'Homepage',
      url: 'https://example.com',
      jobId: 'job_test'
    }
  ],
  ...overrides
});

describe('sqlite control repository', () => {
  test('persists jobs across repository instances', () => {
    const databasePath = createTempDatabasePath();

    {
      const repository = createSqliteJobRepository({ databasePath });
      repository.saveJob(createJob());
      expect(repository.countJobs()).toBe(1);
      repository.close();
    }

    {
      const repository = createSqliteJobRepository({ databasePath });
      const job = repository.getJob('job_test');
      expect(job?.targets[0]?.measurement?.probeImpl).toBe('rust');
      expect(job?.summary.succeeded).toBe(1);
      expect(repository.listJobs()).toHaveLength(1);
      repository.close();
    }
  });

  test('prunes jobs outside the retention window', () => {
    const databasePath = createTempDatabasePath();
    const repository = createSqliteJobRepository({ databasePath });

    repository.saveJob(
      createJob({
        id: 'job_old',
        requestedAt: '2026-03-01T00:00:00.000Z'
      })
    );
    repository.saveJob(
      createJob({
        id: 'job_recent',
        requestedAt: '2026-04-07T00:00:00.000Z'
      })
    );

    const deleted = repository.pruneJobsOlderThan(30, new Date('2026-04-08T00:00:00.000Z'));

    expect(deleted).toBe(1);
    expect(repository.getJob('job_old')).toBeNull();
    expect(repository.getJob('job_recent')?.id).toBe('job_recent');
    repository.close();
  });

  test('persists self-host configuration entities across repository instances', () => {
    const databasePath = createTempDatabasePath();

    {
      const repository = createSqliteJobRepository({ databasePath });
      repository.saveProperty(createProperty());
      repository.saveRouteSet(createRouteSet());
      repository.saveRegionPack(createRegionPack());
      repository.saveCheckProfile(createCheckProfile());
      repository.saveCheckProfileRun(createCheckProfileRun());
      repository.close();
    }

    {
      const repository = createSqliteJobRepository({ databasePath });
      expect(repository.getProperty('property_test')?.name).toBe('Main site');
      expect(repository.getRouteSet('routeset_test')?.routes[0]?.label).toBe('Homepage');
      expect(repository.getRegionPack('regionpack_test')?.regions).toEqual(['tokyo', 'singapore']);
      expect(repository.getCheckProfile('profile_test')?.routeSetId).toBe('routeset_test');
      expect(repository.listProperties()).toHaveLength(1);
      expect(repository.listRouteSets()).toHaveLength(1);
      expect(repository.listRegionPacks()).toHaveLength(1);
      expect(repository.listCheckProfiles()).toHaveLength(1);
      expect(repository.getCheckProfileRun('run_test')?.profileId).toBe('profile_test');
      expect(repository.listCheckProfileRuns('profile_test')).toHaveLength(1);
      repository.close();
    }
  });

  test('deletes saved entities and cascades check profile runs', () => {
    const databasePath = createTempDatabasePath();
    const repository = createSqliteJobRepository({ databasePath });

    repository.saveProperty(createProperty());
    repository.saveRouteSet(createRouteSet());
    repository.saveRegionPack(createRegionPack());
    repository.saveCheckProfile(createCheckProfile());
    repository.saveCheckProfileRun(createCheckProfileRun());

    expect(repository.deleteCheckProfile('profile_test')).toEqual({
      deleted: true,
      deletedRunCount: 1
    });
    expect(repository.getCheckProfile('profile_test')).toBeNull();
    expect(repository.listCheckProfileRuns('profile_test')).toEqual([]);

    expect(repository.deleteRouteSet('routeset_test')).toBe(true);
    expect(repository.deleteRegionPack('regionpack_test')).toBe(true);
    expect(repository.deleteProperty('property_test')).toBe(true);
    expect(repository.listProperties()).toEqual([]);
    expect(repository.listRouteSets()).toEqual([]);
    expect(repository.listRegionPacks()).toEqual([]);

    repository.close();
  });
});
