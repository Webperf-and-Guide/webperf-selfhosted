import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import type { CheckProfile, CheckProfileRun, LatencyJobDetail, Property, RouteSet } from '@webperf/contracts';
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

describe('sqlite control repository', () => {
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
    for (const index of [0, 99, 100, 199, 204]) {
      expect(repository.getJob(`job_legacy_batch_${index}`)).toMatchObject({
        region: 'historical-multi-region',
        historicalRegions: ['tokyo', 'singapore']
      });
    }
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
    repository.close();

    const verifyDatabase = new Database(databasePath, { readonly: true });
    expect(
      verifyDatabase
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM saved_entities WHERE kind = 'region_pack'"
        )
        .get()?.count
    ).toBe(3);
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
