import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import {
  browserAuditResourceSchema,
  type BrowserAuditResource,
  type CheckProfile,
  type CheckProfileRun,
  type LatencyJobDetail,
  type Property,
  type RouteSet
} from '@webperf/contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteJobRepository } from '../src/repository';
import { applySqliteMigrations, openSqliteDatabase } from '../src/database/sqlite';
import { sqliteMigrations } from '../src/database/migrations';
import { createStorageCrypto } from '../src/storage-crypto';

const tempDirs: string[] = [];
const testEncryptionSecret = 'repository-test-encryption-secret';

const createRepository = (databasePath: string) =>
  createSqliteJobRepository({
    databasePath,
    encryptionSecret: testEncryptionSecret,
    runtimeRegionId: 'local'
  });

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
  region: 'local',
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

const createCheckProfile = (overrides: Partial<CheckProfile> = {}): CheckProfile => ({
  id: 'profile_test',
  propertyId: 'property_test',
  routeSetId: 'routeset_test',
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
  browserAuditPolicy: null,
  schedule: null,
  baseline: null,
  locationMigration: null,
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
  browserAuditSummary: null,
  evaluation: null,
  alertDeliveries: [],
  routes: [
    {
      routeId: 'route_home',
      routeLabel: 'Homepage',
      url: 'https://example.com',
      jobId: 'job_test',
      browserAudit: null
    }
  ],
  ...overrides
});

const createBrowserAudit = (
  overrides: Partial<BrowserAuditResource> = {}
): BrowserAuditResource => browserAuditResourceSchema.parse({
  id: 'audit_test',
  targetUrl: 'https://example.com/',
  region: 'tokyo',
  status: 'queued',
  requestedAt: '2026-04-08T00:00:00.000Z',
  startedAt: null,
  completedAt: null,
  policy: {
    preset: 'mobile',
    flow: { steps: [{ type: 'navigate', url: 'https://example.com/' }] }
  },
  customHeaders: [],
  cookies: [],
  result: null,
  error: null,
  ...overrides
});

describe('sqlite control repository', () => {
  test('cancels unfinished retired Regional Runtime jobs without touching standalone work', () => {
    const storageCrypto = createStorageCrypto({ currentSecret: testEncryptionSecret });
    const database = openSqliteDatabase(':memory:');
    const migrationIndex = sqliteMigrations.findIndex(
      (migration) => migration.id === '20260730_007_retired_regional_execution_jobs'
    );
    expect(migrationIndex).toBeGreaterThanOrEqual(0);

    for (const migration of sqliteMigrations.slice(0, migrationIndex)) {
      migration.up(database, { storageCrypto, runtimeRegionId: 'local' });
    }

    const timestamp = '2026-07-30T00:00:00.000Z';
    const insertExecution = database.query(`
      INSERT INTO execution_jobs (
        id, kind, resource_id, status, lease_owner, lease_expires_at,
        attempt_count, max_attempts, available_at, payload_json, error_json,
        created_at, updated_at, completed_at, started_at
      ) VALUES (?, 'network_probe', ?, ?, ?, ?, 0, 3, ?, ?, NULL, ?, ?, ?, ?)
    `);
    insertExecution.run(
      'exec_regional_queued',
      'job_regional_queued',
      'queued',
      null,
      null,
      timestamp,
      storageCrypto.stringify({ version: 'v1' }),
      timestamp,
      timestamp,
      null,
      null
    );
    insertExecution.run(
      'exec_regional_running',
      'job_regional_running',
      'running',
      'retired-runtime',
      '2099-07-30T00:00:00.000Z',
      timestamp,
      storageCrypto.stringify({ version: 'v1' }),
      timestamp,
      timestamp,
      null,
      timestamp
    );
    insertExecution.run(
      'exec_regional_succeeded',
      'job_regional_succeeded',
      'succeeded',
      null,
      null,
      timestamp,
      storageCrypto.stringify({ version: 'v1' }),
      timestamp,
      timestamp,
      timestamp,
      timestamp
    );
    insertExecution.run(
      'exec_standalone_queued',
      'job_standalone_queued',
      'queued',
      null,
      null,
      timestamp,
      storageCrypto.stringify({ version: 'v1' }),
      timestamp,
      timestamp,
      null,
      null
    );
    insertExecution.finalize();

    const linkTarget = database.query(`
      INSERT INTO regional_execution_targets (
        regional_execution_id, execution_job_id, job_id
      ) VALUES (?, ?, ?)
    `);
    for (const suffix of ['queued', 'running', 'succeeded']) {
      linkTarget.run(
        `regional_${suffix}`,
        `exec_regional_${suffix}`,
        `job_regional_${suffix}`
      );
    }
    linkTarget.finalize();

    sqliteMigrations[migrationIndex]!.up(database, {
      storageCrypto,
      runtimeRegionId: 'local'
    });

    const rows = database.query<{
      id: string;
      status: string;
      lease_owner: string | null;
      lease_expires_at: string | null;
      completed_at: string | null;
    }, []>(`
      SELECT id, status, lease_owner, lease_expires_at, completed_at
      FROM execution_jobs
      ORDER BY id
    `).all();
    expect(rows).toEqual([
      {
        id: 'exec_regional_queued',
        status: 'cancelled',
        lease_owner: null,
        lease_expires_at: null,
        completed_at: expect.any(String)
      },
      {
        id: 'exec_regional_running',
        status: 'cancelled',
        lease_owner: null,
        lease_expires_at: null,
        completed_at: expect.any(String)
      },
      {
        id: 'exec_regional_succeeded',
        status: 'succeeded',
        lease_owner: null,
        lease_expires_at: null,
        completed_at: timestamp
      },
      {
        id: 'exec_standalone_queued',
        status: 'queued',
        lease_owner: null,
        lease_expires_at: null,
        completed_at: null
      }
    ]);
    database.close();
  });

  test('migrates published beta multi-region data without rewriting historical target provenance', () => {
    const databasePath = createTempDatabasePath();
    const storageCrypto = createStorageCrypto({ currentSecret: testEncryptionSecret });
    const database = openSqliteDatabase(databasePath);
    const migrationIndex = sqliteMigrations.findIndex(
      (migration) => migration.id === '20260730_005_single_region_stored_data'
    );
    expect(migrationIndex).toBeGreaterThanOrEqual(0);
    const historicalMigrations = sqliteMigrations.slice(0, migrationIndex);

    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    for (const migration of historicalMigrations) {
      migration.up(database, { storageCrypto, runtimeRegionId: 'tokyo' });
      database
        .query('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)')
        .run(migration.id, '2026-07-29T00:00:00.000Z');
    }

    const saveEntity = database.query(`
      INSERT INTO saved_entities (kind, id, created_at, updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    const timestamp = '2026-07-29T00:00:00.000Z';
    saveEntity.run(
      'region_pack',
      'pack_tokyo',
      timestamp,
      timestamp,
      storageCrypto.stringify({
        id: 'pack_tokyo',
        name: 'Tokyo',
        regions: ['tokyo'],
        createdAt: timestamp,
        updatedAt: timestamp
      })
    );
    saveEntity.run(
      'region_pack',
      'pack_global',
      timestamp,
      timestamp,
      storageCrypto.stringify({
        id: 'pack_global',
        name: 'Tokyo and Singapore',
        regions: ['tokyo', 'singapore'],
        createdAt: timestamp,
        updatedAt: timestamp
      })
    );
    saveEntity.run(
      'region_pack',
      'pack_singapore',
      timestamp,
      timestamp,
      storageCrypto.stringify({
        id: 'pack_singapore',
        name: 'Singapore',
        regions: ['singapore'],
        createdAt: timestamp,
        updatedAt: timestamp
      })
    );

    const scheduledProfile = {
      ...createCheckProfile({
        id: 'profile_tokyo',
        schedule: {
          intervalMinutes: 60,
          nextRunAt: '2026-07-29T01:00:00.000Z',
          lastRunAt: null,
          lastRunJobCount: null
        }
      }),
      regionPackId: 'pack_tokyo'
    };
    const multiRegionProfile = {
      ...createCheckProfile({ id: 'profile_global' }),
      regionPackId: 'pack_global'
    };
    const mismatchedProfile = {
      ...createCheckProfile({ id: 'profile_singapore' }),
      regionPackId: 'pack_singapore'
    };
    const missingPackProfile = {
      ...createCheckProfile({ id: 'profile_missing' }),
      regionPackId: 'pack_removed'
    };
    saveEntity.run(
      'check_profile',
      scheduledProfile.id,
      timestamp,
      timestamp,
      storageCrypto.stringify(scheduledProfile)
    );
    saveEntity.run(
      'check_profile',
      multiRegionProfile.id,
      timestamp,
      timestamp,
      storageCrypto.stringify(multiRegionProfile)
    );
    saveEntity.run(
      'check_profile',
      mismatchedProfile.id,
      timestamp,
      timestamp,
      storageCrypto.stringify(mismatchedProfile)
    );
    saveEntity.run(
      'check_profile',
      missingPackProfile.id,
      timestamp,
      timestamp,
      storageCrypto.stringify(missingPackProfile)
    );
    for (let index = 0; index < 205; index += 1) {
      const profileId = `profile_legacy_batch_${index}`;
      saveEntity.run(
        'check_profile',
        profileId,
        timestamp,
        timestamp,
        storageCrypto.stringify({
          ...createCheckProfile({ id: profileId }),
          regionPackId: 'pack_global'
        })
      );
    }
    const pendingNullRegionAudit = createBrowserAudit({
      id: 'audit_legacy_pending_null',
      region: null
    });
    const pendingMismatchedAudit = createBrowserAudit({
      id: 'audit_legacy_pending_singapore',
      region: 'singapore'
    });
    const pendingMatchingAudit = createBrowserAudit({
      id: 'audit_legacy_pending_tokyo',
      region: 'tokyo'
    });
    const completedMismatchedAudit = createBrowserAudit({
      id: 'audit_legacy_completed_singapore',
      region: 'singapore',
      status: 'succeeded',
      startedAt: timestamp,
      completedAt: timestamp
    });
    for (const audit of [
      pendingNullRegionAudit,
      pendingMismatchedAudit,
      pendingMatchingAudit,
      completedMismatchedAudit
    ]) {
      saveEntity.run(
        'browser_audit',
        audit.id,
        timestamp,
        timestamp,
        storageCrypto.stringify(audit)
      );
    }

    const insertRun = database.query(`
      INSERT INTO check_profile_runs (id, profile_id, created_at, payload_json)
      VALUES (?, ?, ?, ?)
    `);
    for (const [runId, profileId, jobId] of [
      ['run_global_pending', multiRegionProfile.id, 'job_test'],
      ['run_tokyo_pending', scheduledProfile.id, 'job_test'],
      [
        'run_singapore_pending',
        mismatchedProfile.id,
        'job_legacy_pending_singleton'
      ]
    ] as const) {
      insertRun.run(
        runId,
        profileId,
        timestamp,
        storageCrypto.stringify(createCheckProfileRun({
          id: runId,
          profileId,
          routes: [
            {
              ...createCheckProfileRun().routes[0]!,
              jobId
            }
          ]
        }))
      );
    }
    for (let index = 0; index < 205; index += 1) {
      const runId = `run_global_batch_${index}`;
      insertRun.run(
        runId,
        multiRegionProfile.id,
        timestamp,
        storageCrypto.stringify(createCheckProfileRun({
          id: runId,
          profileId: multiRegionProfile.id,
          routes: [
            {
              ...createCheckProfileRun().routes[0]!,
              jobId: index === 204
                ? 'job_legacy_late_saved_check'
                : 'job_test'
            }
          ]
        }))
      );
    }
    insertRun.finalize();
    const insertExecution = database.query(`
      INSERT INTO execution_jobs (
        id, kind, resource_id, status, lease_owner, lease_expires_at,
        attempt_count, max_attempts, available_at, payload_json, error_json,
        created_at, updated_at, completed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 3, ?, ?, NULL, ?, ?, NULL)
    `);
    insertExecution.run(
      'exec_global_probe_pending',
      'network_probe',
      'run_global_pending',
      'queued',
      null,
      null,
      0,
      timestamp,
      storageCrypto.stringify({ version: 'v1' }),
      timestamp,
      timestamp
    );
    insertExecution.run(
      'exec_global_webhook_pending',
      'webhook_delivery',
      'run_global_pending',
      'leased',
      'legacy-executor',
      '2026-07-29T00:10:00.000Z',
      1,
      timestamp,
      storageCrypto.stringify({ version: 'v1' }),
      timestamp,
      timestamp
    );
    insertExecution.run(
      'exec_tokyo_probe_pending',
      'network_probe',
      'run_tokyo_pending',
      'queued',
      null,
      null,
      0,
      timestamp,
      storageCrypto.stringify({ version: 'v1' }),
      timestamp,
      timestamp
    );
    insertExecution.run(
      'exec_singapore_probe_pending',
      'network_probe',
      'run_singapore_pending',
      'queued',
      null,
      null,
      0,
      timestamp,
      storageCrypto.stringify({ version: 'v1' }),
      timestamp,
      timestamp
    );
    insertExecution.run(
      'exec_singapore_job_pending',
      'network_probe',
      'job_legacy_pending_singleton',
      'queued',
      null,
      null,
      0,
      timestamp,
      storageCrypto.stringify({ version: 'v1' }),
      timestamp,
      timestamp
    );
    insertExecution.run(
      'exec_standalone_multi_pending',
      'network_probe',
      'job_legacy_pending_multi',
      'queued',
      null,
      null,
      0,
      timestamp,
      storageCrypto.stringify({
        version: 'v1',
        jobIds: ['job_legacy_pending_multi']
      }),
      timestamp,
      timestamp
    );
    for (const [executionId, resourceId] of [
      [
        'exec_standalone_singleton_mismatch_pending',
        'job_legacy_pending_singleton_standalone'
      ],
      [
        'exec_standalone_singleton_match_pending',
        'job_legacy_pending_singleton_match'
      ],
      ['exec_late_saved_check_pending', 'job_legacy_late_saved_check'],
      ['exec_audit_null_pending', pendingNullRegionAudit.id],
      ['exec_audit_mismatch_pending', pendingMismatchedAudit.id],
      ['exec_audit_matching_pending', pendingMatchingAudit.id]
    ] as const) {
      insertExecution.run(
        executionId,
        executionId.startsWith('exec_audit_') ? 'browser_audit' : 'network_probe',
        resourceId,
        'queued',
        null,
        null,
        0,
        timestamp,
        storageCrypto.stringify({ version: 'v1' }),
        timestamp,
        timestamp
      );
    }
    insertExecution.finalize();

    const currentJob = createJob({
      id: 'job_legacy_multi',
      targets: [
        createJob().targets[0]!,
        {
          ...createJob().targets[0]!,
          region: 'singapore',
          measurement: {
            ...createJob().targets[0]!.measurement!,
            region: 'singapore'
          }
        }
      ],
      summary: {
        total: 2,
        succeeded: 2,
        failed: 0,
        inflight: 0
      }
    });
    const {
      region: _removedRegion,
      historicalRegions: _removedHistoricalRegions,
      ...legacyJob
    } = currentJob;
    database.query(`
      INSERT INTO jobs (id, url, status, requested_at, updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      currentJob.id,
      currentJob.url,
      currentJob.status,
      currentJob.requestedAt,
      currentJob.completedAt,
      storageCrypto.stringify({
        ...legacyJob,
        selectedRegions: ['tokyo', 'singapore']
      })
    );
    const pendingLegacyTargets = currentJob.targets.map((target) => ({
      ...target,
      status: 'queued',
      latencyMs: null,
      statusCode: null,
      success: null,
      probeImpl: null,
      measurement: null,
      errorCode: null,
      errorClass: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      updatedAt: timestamp
    }));
    const pendingLegacyJob = {
      ...legacyJob,
      id: 'job_legacy_pending_multi',
      status: 'queued',
      startedAt: null,
      completedAt: null,
      targets: pendingLegacyTargets,
      summary: {
        total: pendingLegacyTargets.length,
        succeeded: 0,
        failed: 0,
        inflight: pendingLegacyTargets.length
      },
      selectedRegions: ['tokyo', 'singapore']
    };
    database.query(`
      INSERT INTO jobs (id, url, status, requested_at, updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      pendingLegacyJob.id,
      pendingLegacyJob.url,
      pendingLegacyJob.status,
      pendingLegacyJob.requestedAt,
      timestamp,
      storageCrypto.stringify(pendingLegacyJob)
    );
    const pendingSingletonTarget = {
      ...pendingLegacyTargets[0]!,
      jobId: 'job_legacy_pending_singleton',
      region: 'singapore'
    };
    const pendingSingletonJob = {
      ...legacyJob,
      id: 'job_legacy_pending_singleton',
      status: 'queued',
      startedAt: null,
      completedAt: null,
      targets: [pendingSingletonTarget],
      summary: {
        total: 1,
        succeeded: 0,
        failed: 0,
        inflight: 1
      },
      selectedRegions: ['singapore']
    };
    database.query(`
      INSERT INTO jobs (id, url, status, requested_at, updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      pendingSingletonJob.id,
      pendingSingletonJob.url,
      pendingSingletonJob.status,
      pendingSingletonJob.requestedAt,
      timestamp,
      storageCrypto.stringify(pendingSingletonJob)
    );
    const createPendingSingletonJob = (id: string, region: string) => ({
      ...pendingSingletonJob,
      id,
      targets: [{
        ...pendingSingletonTarget,
        jobId: id,
        region
      }],
      selectedRegions: [region]
    });
    const pendingStandaloneSingletonMismatchJob = createPendingSingletonJob(
      'job_legacy_pending_singleton_standalone',
      'singapore'
    );
    const pendingStandaloneSingletonMatchJob = createPendingSingletonJob(
      'job_legacy_pending_singleton_match',
      'tokyo'
    );
    const pendingLateSavedCheckJob = createPendingSingletonJob(
      'job_legacy_late_saved_check',
      'tokyo'
    );
    for (const pendingJob of [
      pendingStandaloneSingletonMismatchJob,
      pendingStandaloneSingletonMatchJob,
      pendingLateSavedCheckJob
    ]) {
      database.query(`
        INSERT INTO jobs (id, url, status, requested_at, updated_at, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        pendingJob.id,
        pendingJob.url,
        pendingJob.status,
        pendingJob.requestedAt,
        timestamp,
        storageCrypto.stringify(pendingJob)
      );
    }
    const insertLegacyJob = database.query(`
      INSERT INTO jobs (id, url, status, requested_at, updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (let index = 0; index < 205; index += 1) {
      const jobId = `job_legacy_batch_${index}`;
      insertLegacyJob.run(
        jobId,
        currentJob.url,
        currentJob.status,
        currentJob.requestedAt,
        currentJob.completedAt,
        storageCrypto.stringify({
          ...legacyJob,
          id: jobId,
          selectedRegions: ['tokyo', 'singapore']
        })
      );
    }
    insertLegacyJob.finalize();
    database.close();

    const repository = createSqliteJobRepository({
      databasePath,
      encryptionSecret: testEncryptionSecret,
      runtimeRegionId: 'tokyo'
    });

    expect(repository.getJob(currentJob.id)).toMatchObject({
      region: 'historical-multi-region',
      historicalRegions: ['tokyo', 'singapore'],
      targets: [
        { region: 'tokyo' },
        { region: 'singapore' }
      ]
    });
    expect(repository.getJob(pendingLegacyJob.id)).toMatchObject({
      region: 'historical-multi-region',
      historicalRegions: ['tokyo', 'singapore'],
      status: 'failed',
      summary: {
        total: 2,
        succeeded: 0,
        failed: 2,
        inflight: 0
      },
      targets: [
        {
          region: 'tokyo',
          status: 'failed',
          errorCode: 'single_region_upgrade_cancelled'
        },
        {
          region: 'singapore',
          status: 'failed',
          errorCode: 'single_region_upgrade_cancelled'
        }
      ]
    });
    expect(repository.getJob(pendingSingletonJob.id)).toMatchObject({
      region: 'singapore',
      historicalRegions: ['singapore'],
      status: 'failed',
      summary: {
        total: 1,
        succeeded: 0,
        failed: 1,
        inflight: 0
      },
      targets: [
        {
          region: 'singapore',
          status: 'failed',
          errorCode: 'single_region_upgrade_cancelled'
        }
      ]
    });
    expect(repository.getJob(pendingStandaloneSingletonMismatchJob.id)).toMatchObject({
      region: 'singapore',
      historicalRegions: ['singapore'],
      status: 'failed',
      targets: [{
        region: 'singapore',
        status: 'failed',
        errorCode: 'single_region_upgrade_cancelled'
      }]
    });
    expect(repository.getJob(pendingStandaloneSingletonMatchJob.id)).toMatchObject({
      region: 'tokyo',
      historicalRegions: ['tokyo'],
      status: 'queued',
      targets: [{
        region: 'tokyo',
        status: 'queued'
      }]
    });
    expect(repository.getJob(pendingLateSavedCheckJob.id)).toMatchObject({
      region: 'tokyo',
      historicalRegions: ['tokyo'],
      status: 'failed',
      targets: [{
        region: 'tokyo',
        status: 'failed',
        errorCode: 'single_region_upgrade_cancelled'
      }]
    });
    for (const index of [0, 99, 100, 199, 204]) {
      expect(repository.getJob(`job_legacy_batch_${index}`)).toMatchObject({
        region: 'historical-multi-region',
        historicalRegions: ['tokyo', 'singapore']
      });
    }
    expect(repository.getBrowserAudit(pendingNullRegionAudit.id)).toMatchObject({
      region: null,
      status: 'cancelled',
      completedAt: expect.any(String)
    });
    expect(repository.getBrowserAudit(pendingMismatchedAudit.id)).toMatchObject({
      region: 'singapore',
      status: 'cancelled',
      completedAt: expect.any(String)
    });
    expect(repository.getBrowserAudit(pendingMatchingAudit.id)).toMatchObject({
      region: 'tokyo',
      status: 'queued',
      completedAt: null
    });
    expect(repository.getBrowserAudit(completedMismatchedAudit.id)).toMatchObject({
      region: 'singapore',
      status: 'succeeded',
      completedAt: timestamp
    });
    expect(repository.getCheckProfile('profile_tokyo')).toMatchObject({
      schedule: {
        intervalMinutes: 60
      },
      locationMigration: {
        sourceRegionPackId: 'pack_tokyo',
        sourceRegions: ['tokyo'],
        runtimeRegionId: 'tokyo',
        status: 'applied',
        reason: 'singleton_matches_runtime'
      }
    });
    expect(repository.getCheckProfile('profile_global')).toMatchObject({
      schedule: null,
      locationMigration: {
        sourceRegionPackId: 'pack_global',
        sourceRegions: ['tokyo', 'singapore'],
        runtimeRegionId: 'tokyo',
        status: 'requires_review',
        reason: 'legacy_multi_region'
      }
    });
    expect(repository.getCheckProfile('profile_singapore')).toMatchObject({
      schedule: null,
      locationMigration: {
        sourceRegionPackId: 'pack_singapore',
        sourceRegions: ['singapore'],
        runtimeRegionId: 'tokyo',
        status: 'requires_review',
        reason: 'legacy_region_mismatch'
      }
    });
    expect(repository.getCheckProfile('profile_missing')).toMatchObject({
      schedule: null,
      locationMigration: {
        sourceRegionPackId: 'pack_removed',
        sourceRegions: [],
        runtimeRegionId: 'tokyo',
        status: 'requires_review',
        reason: 'legacy_region_pack_missing'
      }
    });
    for (const index of [0, 99, 100, 199, 204]) {
      expect(repository.getCheckProfile(`profile_legacy_batch_${index}`)).toMatchObject({
        schedule: null,
        locationMigration: {
          sourceRegionPackId: 'pack_global',
          sourceRegions: ['tokyo', 'singapore'],
          runtimeRegionId: 'tokyo',
          status: 'requires_review',
          reason: 'legacy_multi_region'
        }
      });
    }
    repository.close();

    const verifyDatabase = new Database(databasePath, { readonly: true });
    expect(
      verifyDatabase
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM saved_entities WHERE kind = 'region_pack'"
        )
        .get()?.count
    ).toBe(3);
    expect(
      verifyDatabase
        .query<{ id: string; status: string }, []>(`
          SELECT id, status
          FROM execution_jobs
          WHERE id IN (
            'exec_global_probe_pending',
            'exec_global_webhook_pending',
            'exec_singapore_job_pending',
            'exec_singapore_probe_pending',
            'exec_tokyo_probe_pending',
            'exec_standalone_multi_pending',
            'exec_standalone_singleton_mismatch_pending',
            'exec_standalone_singleton_match_pending',
            'exec_late_saved_check_pending',
            'exec_audit_null_pending',
            'exec_audit_mismatch_pending',
            'exec_audit_matching_pending'
          )
          ORDER BY id
        `)
        .all()
    ).toEqual([
      { id: 'exec_audit_matching_pending', status: 'queued' },
      { id: 'exec_audit_mismatch_pending', status: 'cancelled' },
      { id: 'exec_audit_null_pending', status: 'cancelled' },
      { id: 'exec_global_probe_pending', status: 'cancelled' },
      { id: 'exec_global_webhook_pending', status: 'cancelled' },
      { id: 'exec_late_saved_check_pending', status: 'cancelled' },
      { id: 'exec_singapore_job_pending', status: 'cancelled' },
      { id: 'exec_singapore_probe_pending', status: 'cancelled' },
      { id: 'exec_standalone_multi_pending', status: 'cancelled' },
      { id: 'exec_standalone_singleton_match_pending', status: 'queued' },
      { id: 'exec_standalone_singleton_mismatch_pending', status: 'cancelled' },
      { id: 'exec_tokyo_probe_pending', status: 'queued' }
    ]);
    verifyDatabase.close();
  });

  test('requires an explicit runtime region before migrating legacy saved Checks', () => {
    const storageCrypto = createStorageCrypto({ currentSecret: testEncryptionSecret });
    const database = openSqliteDatabase(':memory:');
    const migrationIndex = sqliteMigrations.findIndex(
      (migration) => migration.id === '20260730_005_single_region_stored_data'
    );
    expect(migrationIndex).toBeGreaterThanOrEqual(0);
    const historicalMigrations = sqliteMigrations.slice(0, migrationIndex);
    for (const migration of historicalMigrations) {
      migration.up(database, { storageCrypto });
    }
    const timestamp = '2026-07-29T00:00:00.000Z';
    database.query(`
      INSERT INTO saved_entities (kind, id, created_at, updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'check_profile',
      'profile_legacy',
      timestamp,
      timestamp,
      storageCrypto.stringify({
        ...createCheckProfile({ id: 'profile_legacy' }),
        regionPackId: 'pack_legacy'
      })
    );

    expect(() => {
      sqliteMigrations[migrationIndex]!.up(database, { storageCrypto });
    }).toThrow('SELFHOST_REGION_ID is required');
    database.close();
  });

  test('requires runtime identity for legacy Jobs and unfinished Browser Audits', () => {
    const migrationIndex = sqliteMigrations.findIndex(
      (migration) => migration.id === '20260730_005_single_region_stored_data'
    );
    expect(migrationIndex).toBeGreaterThanOrEqual(0);
    const historicalMigrations = sqliteMigrations.slice(0, migrationIndex);
    const timestamp = '2026-07-29T00:00:00.000Z';
    const legacyJob = createJob({
      id: 'job_legacy_runtime_bound',
      status: 'queued',
      startedAt: null,
      completedAt: null
    });
    const {
      region: _removedRegion,
      historicalRegions: _removedHistoricalRegions,
      ...legacyJobWithoutRegion
    } = legacyJob;

    for (const seed of [
      (database: Database, storageCrypto: ReturnType<typeof createStorageCrypto>) => {
        database.query(`
          INSERT INTO jobs (id, url, status, requested_at, updated_at, payload_json)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          legacyJob.id,
          legacyJob.url,
          legacyJob.status,
          legacyJob.requestedAt,
          timestamp,
          storageCrypto.stringify({
            ...legacyJobWithoutRegion,
            selectedRegions: ['singapore']
          })
        );
      },
      (database: Database, storageCrypto: ReturnType<typeof createStorageCrypto>) => {
        const audit = createBrowserAudit({
          id: 'audit_legacy_runtime_bound',
          region: null,
          status: 'queued'
        });
        database.query(`
          INSERT INTO saved_entities (kind, id, created_at, updated_at, payload_json)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          'browser_audit',
          audit.id,
          timestamp,
          timestamp,
          storageCrypto.stringify(audit)
        );
      }
    ]) {
      const storageCrypto = createStorageCrypto({
        currentSecret: testEncryptionSecret
      });
      const database = openSqliteDatabase(':memory:');
      for (const migration of historicalMigrations) {
        migration.up(database, { storageCrypto });
      }
      seed(database, storageCrypto);

      expect(() => {
        sqliteMigrations[migrationIndex]!.up(database, { storageCrypto });
      }).toThrow('SELFHOST_REGION_ID is required');
      database.close();
    }
  });

  test('encrypts persisted payloads and supports key rotation', () => {
    const databasePath = createTempDatabasePath();
    const secretValue = 'Bearer must-not-appear-in-sqlite';
    const querySecret = 'query-secret-must-not-appear';
    const job = createJob({
      url: `https://example.com/?token=${querySecret}`,
      request: {
        method: 'GET',
        headers: [{ name: 'Authorization', value: secretValue }],
        body: null
      }
    });

    {
      const repository = createSqliteJobRepository({
        databasePath,
        encryptionSecret: 'old-storage-encryption-secret'
      });
      repository.saveJob(job);
      repository.close();
    }

    const database = new Database(databasePath, { readonly: true });
    const row = database.query<{ payload_json: string; url: string }, []>('SELECT payload_json, url FROM jobs LIMIT 1').get();
    expect(row?.payload_json.startsWith('webperf:enc:v2:')).toBe(true);
    expect(row?.payload_json).not.toContain(secretValue);
    expect(row?.payload_json).not.toContain(querySecret);
    expect(row?.url).toBe('https://example.com/?redacted');
    database.close();

    {
      const repository = createSqliteJobRepository({
        databasePath,
        encryptionSecret: 'new-storage-encryption-secret',
        encryptionSecretNext: 'old-storage-encryption-secret'
      });
      expect(repository.getJob(job.id)?.request?.headers[0]?.value).toBe(secretValue);
      repository.saveJob(job);
      repository.close();
    }

    {
      const repository = createSqliteJobRepository({
        databasePath,
        encryptionSecret: 'new-storage-encryption-secret'
      });
      expect(repository.getJob(job.id)?.request?.headers[0]?.value).toBe(secretValue);
      repository.close();
    }
  });

  test('migrates legacy plaintext and v1 envelopes once, then rejects plaintext downgrades', () => {
    const databasePath = createTempDatabasePath();
    const encryptionSecret = 'legacy-migration-encryption-secret';
    const plaintextJob = createJob({ id: 'job_plaintext' });
    const legacyJob = createJob({ id: 'job_legacy_v1' });
    const database = new Database(databasePath, { create: true });
    database.exec(`
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
    `);
    const insert = database.query(`
      INSERT INTO jobs (id, url, status, requested_at, updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      plaintextJob.id,
      plaintextJob.url,
      plaintextJob.status,
      plaintextJob.requestedAt,
      plaintextJob.requestedAt,
      JSON.stringify(plaintextJob)
    );
    insert.run(
      legacyJob.id,
      legacyJob.url,
      legacyJob.status,
      legacyJob.requestedAt,
      legacyJob.requestedAt,
      createLegacyV1Envelope(legacyJob, encryptionSecret)
    );
    database.close();

    const repository = createSqliteJobRepository({ databasePath, encryptionSecret });
    expect(repository.getJob(plaintextJob.id)?.id).toBe(plaintextJob.id);
    expect(repository.getJob(legacyJob.id)?.id).toBe(legacyJob.id);
    repository.close();

    const migratedDatabase = new Database(databasePath);
    const migratedRows = migratedDatabase
      .query<{ payload_json: string }, []>('SELECT payload_json FROM jobs ORDER BY id')
      .all();
    expect(migratedRows.every((row) => row.payload_json.startsWith('webperf:enc:v2:'))).toBe(true);
    migratedDatabase
      .query('UPDATE jobs SET payload_json = ? WHERE id = ?')
      .run(JSON.stringify(plaintextJob), plaintextJob.id);
    migratedDatabase.close();

    const strictRepository = createSqliteJobRepository({ databasePath, encryptionSecret });
    expect(strictRepository.getJob(plaintextJob.id)).toBeNull();
    expect(strictRepository.getJob(legacyJob.id)?.id).toBe(legacyJob.id);
    strictRepository.close();
  });

  test('persists jobs across repository instances', () => {
    const databasePath = createTempDatabasePath();

    {
      const repository = createRepository(databasePath);
      repository.saveJob(createJob());
      expect(repository.countJobs()).toBe(1);
      repository.close();
    }

    {
      const repository = createRepository(databasePath);
      const job = repository.getJob('job_test');
      expect(job?.targets[0]?.measurement?.probeImpl).toBe('rust');
      expect(job?.summary.succeeded).toBe(1);
      expect(repository.listJobs()).toHaveLength(1);
      repository.close();
    }
  });

  test('prunes jobs outside the retention window', () => {
    const databasePath = createTempDatabasePath();
    const repository = createRepository(databasePath);

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
      const repository = createRepository(databasePath);
      repository.saveProperty(createProperty());
      repository.saveRouteSet(createRouteSet());
      repository.saveCheckProfile(createCheckProfile());
      repository.saveCheckProfileRun(createCheckProfileRun());
      repository.close();
    }

    {
      const repository = createRepository(databasePath);
      expect(repository.getProperty('property_test')?.name).toBe('Main site');
      expect(repository.getRouteSet('routeset_test')?.routes[0]?.label).toBe('Homepage');
      expect(repository.getCheckProfile('profile_test')?.routeSetId).toBe('routeset_test');
      expect(repository.listProperties()).toHaveLength(1);
      expect(repository.listRouteSets()).toHaveLength(1);
      expect(repository.listCheckProfiles()).toHaveLength(1);
      expect(repository.getCheckProfileRun('run_test')?.profileId).toBe('profile_test');
      expect(repository.listCheckProfileRuns('profile_test')).toHaveLength(1);
      repository.close();
    }
  });

  test('deletes saved entities and cascades check profile runs', () => {
    const databasePath = createTempDatabasePath();
    const repository = createRepository(databasePath);

    repository.saveProperty(createProperty());
    repository.saveRouteSet(createRouteSet());
    repository.saveCheckProfile(createCheckProfile());
    repository.saveCheckProfileRun(createCheckProfileRun());

    expect(repository.deleteCheckProfile('profile_test')).toEqual({
      deleted: true,
      deletedRunCount: 1
    });
    expect(repository.getCheckProfile('profile_test')).toBeNull();
    expect(repository.listCheckProfileRuns('profile_test')).toEqual([]);

    expect(repository.deleteRouteSet('routeset_test')).toBe(true);
    expect(repository.deleteProperty('property_test')).toBe(true);
    expect(repository.listProperties()).toEqual([]);
    expect(repository.listRouteSets()).toEqual([]);

    repository.close();
  });
});

const createLegacyV1Envelope = (value: unknown, secret: string) => {
  const iv = randomBytes(12);
  const key = createHash('sha256').update(secret, 'utf8').digest();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('webperf-selfhosted/sqlite-payload/v1', 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [
    'webperf:enc:v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url')
  ].join(':');
};
