import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  backupSqliteDatabase,
  cleanupSqliteRetention,
  doctorSqliteDatabase,
  maintainSqliteDatabase,
  restoreSqliteDatabase,
  verifySqliteStorageCrypto
} from '../src/database/operations';
import {
  applySqliteMigrations,
  IncompatibleSqliteSchemaError,
  openSqliteDatabase,
  SqliteMigrationError
} from '../src/database/sqlite';
import { sqliteMigrations } from '../src/database/migrations';
import { createStorageCrypto } from '../src/storage-crypto';
import { createSqliteJobRepository } from '../src/repository';

const tempDirectories: string[] = [];
const encryptionSecret = 'database-operations-test-secret';
const storageCrypto = () => createStorageCrypto({ currentSecret: encryptionSecret });

const createTempPaths = () => {
  const directory = mkdtempSync(join(tmpdir(), 'webperf-database-'));
  tempDirectories.push(directory);
  return {
    directory,
    databasePath: join(directory, 'webperf.sqlite'),
    backupPath: join(directory, 'backups', 'webperf.sqlite')
  };
};

const migrateDatabase = (databasePath: string) => {
  const database = openSqliteDatabase(databasePath);
  const result = applySqliteMigrations(database, {
    storageCrypto: storageCrypto()
  });
  return { database, result };
};

afterEach(() => {
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();

    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe('SQLite operations', () => {
  test('applies the ordered manifest and enforces production pragmas', () => {
    const { databasePath } = createTempPaths();
    const { database, result } = migrateDatabase(databasePath);

    expect(result.appliedNow).toEqual(sqliteMigrations.map((migration) => migration.id));
    expect(database.query<{ journal_mode: string }, []>('PRAGMA journal_mode').get()?.journal_mode)
      .toBe('wal');
    expect(database.query<{ timeout: number }, []>('PRAGMA busy_timeout').get()?.timeout)
      .toBe(5_000);
    expect(database.query<{ foreign_keys: number }, []>('PRAGMA foreign_keys').get()?.foreign_keys)
      .toBe(1);
    expect(database.query<{ synchronous: number }, []>('PRAGMA synchronous').get()?.synchronous)
      .toBe(1);
    expect(database.query<{ wal_autocheckpoint: number }, []>('PRAGMA wal_autocheckpoint').get()?.wal_autocheckpoint)
      .toBe(1_000);
    database.close();

    const report = doctorSqliteDatabase(databasePath);
    expect(report.ok).toBe(true);
    expect(report.migrations.pending).toEqual([]);
  });

  test('creates a private database parent directory', () => {
    const { directory } = createTempPaths();
    const privateDirectory = join(directory, 'private-state');
    const database = openSqliteDatabase(join(privateDirectory, 'webperf.sqlite'));
    database.close();

    expect(statSync(privateDirectory).mode & 0o777).toBe(0o700);
  });

  test('resolves migration context only when pending work runs', () => {
    const { databasePath } = createTempPaths();
    const database = openSqliteDatabase(databasePath);
    let contextCalls = 0;
    const contextProvider = () => {
      contextCalls += 1;
      return { storageCrypto: storageCrypto() };
    };

    expect(applySqliteMigrations(database, contextProvider).appliedNow)
      .toEqual(sqliteMigrations.map((migration) => migration.id));
    expect(contextCalls).toBe(1);

    expect(applySqliteMigrations(database, () => {
      throw new Error('No-op migration must not resolve its context');
    })).toMatchObject({ appliedNow: [], pending: [] });
    expect(contextCalls).toBe(1);
    database.close();
  });

  test('rechecks migration state under one write lock when another runner wins', () => {
    const { databasePath } = createTempPaths();
    const first = openSqliteDatabase(databasePath);
    const second = openSqliteDatabase(databasePath);
    const context = {
      storageCrypto: createStorageCrypto({ currentSecret: encryptionSecret })
    };
    let winningMigrationIds: string[] = [];

    const result = applySqliteMigrations(first, context, {
      beforeMigrate() {
        winningMigrationIds = applySqliteMigrations(second, context).appliedNow;
      }
    });

    expect(winningMigrationIds).toEqual(sqliteMigrations.map((migration) => migration.id));
    expect(result.appliedNow).toEqual([]);
    expect(result.pending).toEqual([]);
    first.close();
    second.close();
  });

  test('encrypts legacy payloads across migration batches', () => {
    const { databasePath } = createTempPaths();
    const database = openSqliteDatabase(databasePath);
    const crypto = storageCrypto();
    sqliteMigrations[0]!.up(database, { storageCrypto: crypto });
    const insert = database.query(`
      INSERT INTO jobs (id, url, status, requested_at, updated_at, payload_json)
      VALUES (?, 'https://example.com/', 'succeeded', ?, ?, ?)
    `);
    const seed = database.transaction(() => {
      for (let index = 0; index < 205; index += 1) {
        const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
        insert.run(`job_migration_${index}`, createdAt, createdAt, JSON.stringify({ index }));
      }
    });
    seed.immediate();
    insert.finalize();

    applySqliteMigrations(database, { storageCrypto: crypto });

    expect(database.query<{ count: number }, []>(`
      SELECT COUNT(*) AS count FROM jobs WHERE payload_json LIKE 'webperf:enc:v2:%'
    `).get()?.count).toBe(205);
    database.close();
  });

  test('identifies the migration that failed without losing the original cause', () => {
    const { databasePath } = createTempPaths();
    const database = openSqliteDatabase(databasePath);
    const crypto = storageCrypto();
    sqliteMigrations[0]!.up(database, { storageCrypto: crypto });
    database.exec(`
      CREATE TABLE schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    database.query('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
      sqliteMigrations[0]!.id,
      '2026-07-22T00:00:00.000Z'
    );
    database.query(`
      INSERT INTO jobs (id, url, status, requested_at, updated_at, payload_json)
      VALUES ('job_invalid_json', 'https://example.com/', 'queued', ?, ?, '{')
    `).run('2026-07-22T00:00:00.000Z', '2026-07-22T00:00:00.000Z');

    try {
      applySqliteMigrations(database, { storageCrypto: crypto });
      throw new Error('Expected the encrypted payload migration to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(SqliteMigrationError);
      expect((error as SqliteMigrationError).migrationId).toBe(sqliteMigrations[1]!.id);
      expect((error as Error).cause).toBeInstanceOf(SyntaxError);
    } finally {
      database.close();
    }
  });

  test('refuses to open a database migrated by an unknown newer version', () => {
    const { databasePath } = createTempPaths();
    const { database } = migrateDatabase(databasePath);
    database
      .query('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)')
      .run('20990101_001_future_schema', '2099-01-01T00:00:00.000Z');
    database.close();

    expect(() => createSqliteJobRepository({ databasePath, encryptionSecret }))
      .toThrow(IncompatibleSqliteSchemaError);
  });

  test('backs up WAL-visible data and restores with a verified safety backup', () => {
    const { databasePath, backupPath } = createTempPaths();
    const { database } = migrateDatabase(databasePath);
    database.query(`
      INSERT INTO jobs (id, url, status, requested_at, updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'job_restore',
      'https://example.com/',
      'queued',
      '2026-07-22T00:00:00.000Z',
      '2026-07-22T00:00:00.000Z',
      storageCrypto().stringify({ id: 'job_restore' })
    );

    backupSqliteDatabase({ databasePath, destinationPath: backupPath });
    database.query('UPDATE jobs SET status = ? WHERE id = ?').run('succeeded', 'job_restore');
    database.close();

    const restored = restoreSqliteDatabase({
      databasePath,
      sourcePath: backupPath,
      storageCrypto: storageCrypto(),
      now: new Date('2026-07-22T12:00:00.000Z')
    });
    expect(restored.currentBackupPath).not.toBeNull();
    expect(restored.verifiedEncryptedPayloads).toBe(1);

    const current = new Database(databasePath, { readonly: true });
    expect(current.query<{ status: string }, []>('SELECT status FROM jobs').get()?.status)
      .toBe('queued');
    current.close();

    const safetyBackup = new Database(restored.currentBackupPath!, { readonly: true });
    expect(safetyBackup.query<{ status: string }, []>('SELECT status FROM jobs').get()?.status)
      .toBe('succeeded');
    safetyBackup.close();
  });

  test('requires an explicit opt-in to restore an older schema', () => {
    const { directory, databasePath } = createTempPaths();
    const legacyPath = join(directory, 'legacy.sqlite');
    const legacy = new Database(legacyPath, { create: true });
    legacy.exec('CREATE TABLE legacy_data (value TEXT NOT NULL);');
    legacy.close();

    const { database } = migrateDatabase(databasePath);
    database.close();

    expect(() => restoreSqliteDatabase({
      databasePath,
      sourcePath: legacyPath,
      storageCrypto: storageCrypto(),
      backupCurrent: false
    })).toThrow('missing required migrations');

    const result = restoreSqliteDatabase({
      databasePath,
      sourcePath: legacyPath,
      storageCrypto: storageCrypto(),
      backupCurrent: false,
      allowPendingMigrations: true
    });
    expect(result.pendingMigrationIds)
      .toEqual(sqliteMigrations.map((migration) => migration.id));

    const restored = new Database(databasePath, { readonly: true });
    expect(restored
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'legacy_data'"
      )
      .get()?.name).toBe('legacy_data');
    restored.close();
  });

  test('rejects an incompatible restore secret before replacing the destination', () => {
    const { directory } = createTempPaths();
    const sourcePath = join(directory, 'encrypted-source.sqlite');
    const destinationPath = join(directory, 'destination.sqlite');
    const { database } = migrateDatabase(sourcePath);
    database.query(`
      INSERT INTO jobs (id, url, status, requested_at, updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'job_encrypted_restore',
      'https://example.com/',
      'succeeded',
      '2026-07-22T00:00:00.000Z',
      '2026-07-22T00:00:00.000Z',
      storageCrypto().stringify({ id: 'job_encrypted_restore' })
    );
    database.close();
    const destination = new Database(destinationPath, { create: true });
    destination.exec('CREATE TABLE destination_marker (value TEXT NOT NULL);');
    destination.query('INSERT INTO destination_marker (value) VALUES (?)').run('preserved');
    destination.close();

    expect(() => restoreSqliteDatabase({
      databasePath: destinationPath,
      sourcePath,
      storageCrypto: createStorageCrypto({ currentSecret: 'different-restore-secret' }),
      backupCurrent: false
    })).toThrow('incompatible with the configured internal secret');

    const unchanged = new Database(destinationPath, { readonly: true });
    expect(unchanged.query<{ value: string }, []>('SELECT value FROM destination_marker').get())
      .toEqual({ value: 'preserved' });
    unchanged.close();
  });

  test('fails closed when encrypted payload verification exceeds its explicit bound', () => {
    const { databasePath } = createTempPaths();
    const { database } = migrateDatabase(databasePath);
    const crypto = storageCrypto();
    const insert = database.query(`
      INSERT INTO jobs (id, url, status, requested_at, updated_at, payload_json)
      VALUES (?, 'https://example.com/', 'succeeded', ?, ?, ?)
    `);
    for (const id of ['job_verify_1', 'job_verify_2']) {
      insert.run(
        id,
        '2026-07-22T00:00:00.000Z',
        '2026-07-22T00:00:00.000Z',
        crypto.stringify({ id })
      );
    }
    insert.finalize();

    expect(() => verifySqliteStorageCrypto(database, crypto, { maximumPayloads: 1 }))
      .toThrow('verification limit of 1');
    expect(() => verifySqliteStorageCrypto(database, crypto, { maximumPayloads: 0 }))
      .toThrow('positive integer');
    database.close();
  });

  test('cleans only expired retained data and can run full maintenance', () => {
    const { databasePath } = createTempPaths();
    const { database } = migrateDatabase(databasePath);
    const insertJob = database.query(`
      INSERT INTO jobs (id, url, status, requested_at, updated_at, payload_json)
      VALUES (?, 'https://example.com/', 'succeeded', ?, ?, 'payload')
    `);
    insertJob.run('job_old', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z');
    insertJob.run(
      'job_regional_completed',
      '2026-05-01T00:00:00.000Z',
      '2026-05-01T00:00:00.000Z'
    );
    insertJob.run('job_recent', '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z');
    database.query(`
      INSERT INTO jobs (id, url, status, requested_at, updated_at, payload_json)
      VALUES (
        'job_active', 'https://example.com/', 'queued',
        '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', 'payload'
      )
    `).run();
    database.query(`
      INSERT INTO check_profile_runs (id, profile_id, created_at, payload_json)
      VALUES ('run_old', 'check_1', '2026-05-01T00:00:00.000Z', 'payload')
    `).run();
    database.query(`
      INSERT INTO saved_entities (kind, id, created_at, updated_at, payload_json)
      VALUES
        ('comparison', 'comparison_old', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', 'payload'),
        ('browser_audit', 'audit_active', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', 'payload'),
        ('regional_execution', 'regional_old', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', 'payload'),
        ('regional_execution', 'regional_active', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', 'payload'),
        ('property', 'property_old', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', 'payload')
    `).run();
    database.query(`
      INSERT INTO execution_jobs (
        id, kind, resource_id, status, lease_owner, lease_expires_at,
        attempt_count, max_attempts, available_at, payload_json, error_json,
        created_at, updated_at, completed_at
      ) VALUES (
        'exec_active', 'browser_audit', 'audit_active', 'queued', NULL, NULL,
        0, 3, '2026-05-01T00:00:00.000Z', 'payload', NULL,
        '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', NULL
      )
    `).run();
    database.query(`
      INSERT INTO execution_jobs (
        id, kind, resource_id, status, lease_owner, lease_expires_at,
        attempt_count, max_attempts, available_at, payload_json, error_json,
        created_at, updated_at, completed_at
      ) VALUES (
        'exec_regional_completed', 'network_probe', 'regional_active',
        'succeeded', NULL, NULL,
        1, 3, '2026-05-01T00:00:00.000Z', 'payload', NULL,
        '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z',
        '2026-05-01T00:00:00.000Z'
      )
    `).run();
    database.query(`
      INSERT INTO regional_execution_targets (
        regional_execution_id, execution_job_id, job_id
      ) VALUES (
        'regional_active', 'exec_regional_completed', 'job_regional_completed'
      )
    `).run();
    database.query(`
      INSERT INTO execution_jobs (
        id, kind, resource_id, status, lease_owner, lease_expires_at,
        attempt_count, max_attempts, available_at, payload_json, error_json,
        created_at, updated_at, completed_at
      ) VALUES (
        'exec_regional_active', 'network_probe', 'regional_active', 'queued', NULL, NULL,
        0, 3, '2026-05-01T00:00:00.000Z', 'payload', NULL,
        '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', NULL
      )
    `).run();
    database.query(`
      INSERT INTO browser_audit_artifacts (
        id, audit_id, registry_version, kind, filename, content_type,
        byte_size, sha256, storage_key, created_at
      ) VALUES
        ('artifact_active', 'audit_active', 'v1', 'lighthouse-json', 'active.json',
         'application/json', 6, '${'a'.repeat(64)}', 'audit_active/artifact_active',
         '2026-05-01T00:00:00.000Z'),
        ('artifact_orphan', 'audit_missing', 'v1', 'lighthouse-json', 'orphan.json',
         'application/json', 6, '${'b'.repeat(64)}', 'audit_missing/artifact_orphan',
         '2026-05-01T00:00:00.000Z')
    `).run();
    database.query(`
      INSERT INTO execution_jobs (
        id, kind, resource_id, status, lease_owner, lease_expires_at,
        attempt_count, max_attempts, available_at, payload_json, error_json,
        created_at, updated_at, completed_at
      ) VALUES (
        'exec_old', 'network_probe', 'job_old', 'succeeded', NULL, NULL,
        1, 3, '2026-05-01T00:00:00.000Z', 'payload', NULL,
        '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'
      )
    `).run();

    expect(cleanupSqliteRetention(
      database,
      30,
      new Date('2026-07-22T00:00:00.000Z')
    )).toEqual({
      jobs: 1,
      checkRuns: 1,
      executionJobs: 1,
      derivedResources: 2,
      artifactIndexes: 1
    });
    expect(database.query<{ id: string }, []>('SELECT id FROM jobs ORDER BY id').all())
      .toEqual([
        { id: 'job_active' },
        { id: 'job_recent' },
        { id: 'job_regional_completed' }
      ]);
    expect(database.query<{ id: string }, []>(`
      SELECT id FROM execution_jobs ORDER BY id
    `).all()).toEqual([
      { id: 'exec_active' },
      { id: 'exec_regional_active' },
      { id: 'exec_regional_completed' }
    ]);
    expect(database.query<{ id: string }, []>('SELECT id FROM saved_entities ORDER BY id').all())
      .toEqual([
        { id: 'audit_active' },
        { id: 'property_old' },
        { id: 'regional_active' }
      ]);
    expect(database.query<{ id: string }, []>('SELECT id FROM browser_audit_artifacts').all())
      .toEqual([{ id: 'artifact_active' }]);
    database.close();

    const result = maintainSqliteDatabase({
      databasePath,
      retentionDays: 30,
      vacuum: true,
      now: new Date('2026-07-22T00:00:00.000Z')
    });
    expect(result.vacuumed).toBe(true);
    expect(result.checkpoint.busy).toBe(0);
  });

  test('deletes retained rows across bounded batches', () => {
    const { databasePath } = createTempPaths();
    const { database } = migrateDatabase(databasePath);
    const insert = database.query(`
      INSERT INTO check_profile_runs (id, profile_id, created_at, payload_json)
      VALUES (?, 'check_batch', '2026-01-01T00:00:00.000Z', 'payload')
    `);
    const seed = database.transaction(() => {
      for (let index = 0; index < 501; index += 1) {
        insert.run(`run_batch_${index}`);
      }
    });
    seed.immediate();
    insert.finalize();

    expect(cleanupSqliteRetention(
      database,
      30,
      new Date('2026-07-22T00:00:00.000Z')
    ).checkRuns).toBe(501);
    expect(database.query<{ count: number }, []>(`
      SELECT COUNT(*) AS count FROM check_profile_runs
    `).get()?.count).toBe(0);
    database.close();
  });

  test('retains and deletes each regional execution as one lifecycle unit', () => {
    const { databasePath } = createTempPaths();
    const { database } = migrateDatabase(databasePath);
    database.exec(`
      INSERT INTO saved_entities (
        kind, id, created_at, updated_at, payload_json
      ) VALUES (
        'regional_execution', 'regional_recent_completion',
        '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', 'payload'
      );
      INSERT INTO jobs (
        id, url, status, requested_at, updated_at, payload_json
      ) VALUES (
        'job_recent_completion', 'https://example.com/', 'succeeded',
        '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', 'payload'
      );
      INSERT INTO execution_jobs (
        id, kind, resource_id, status, lease_owner, lease_expires_at,
        attempt_count, max_attempts, available_at, payload_json, error_json,
        created_at, updated_at, completed_at
      ) VALUES (
        'exec_recent_completion', 'network_probe', 'regional_recent_completion',
        'succeeded', NULL, NULL, 1, 3,
        '2026-05-01T00:00:00.000Z', 'payload', NULL,
        '2026-05-01T00:00:00.000Z', '2026-07-20T00:00:00.000Z',
        '2026-07-20T00:00:00.000Z'
      );
      INSERT INTO regional_execution_targets (
        regional_execution_id, execution_job_id, job_id
      ) VALUES (
        'regional_recent_completion',
        'exec_recent_completion',
        'job_recent_completion'
      );
    `);

    expect(cleanupSqliteRetention(
      database,
      30,
      new Date('2026-07-22T00:00:00.000Z')
    )).toEqual({
      jobs: 0,
      checkRuns: 0,
      executionJobs: 0,
      derivedResources: 0,
      artifactIndexes: 0
    });
    expect(database.query<{ count: number }, []>(`
      SELECT COUNT(*) AS count
      FROM saved_entities
      WHERE kind = 'regional_execution'
    `).get()?.count).toBe(1);
    expect(database.query<{ count: number }, []>(`
      SELECT COUNT(*) AS count FROM jobs WHERE id = 'job_recent_completion'
    `).get()?.count).toBe(1);
    expect(database.query<{ count: number }, []>(`
      SELECT COUNT(*) AS count
      FROM execution_jobs
      WHERE id = 'exec_recent_completion'
    `).get()?.count).toBe(1);
    expect(database.query<{ count: number }, []>(`
      SELECT COUNT(*) AS count
      FROM regional_execution_targets
      WHERE regional_execution_id = 'regional_recent_completion'
    `).get()?.count).toBe(1);

    expect(cleanupSqliteRetention(
      database,
      30,
      new Date('2026-08-22T00:00:00.000Z')
    )).toEqual({
      jobs: 1,
      checkRuns: 0,
      executionJobs: 1,
      derivedResources: 1,
      artifactIndexes: 0
    });
    expect(database.query<{ count: number }, []>(`
      SELECT COUNT(*) AS count
      FROM regional_execution_targets
      WHERE regional_execution_id = 'regional_recent_completion'
    `).get()?.count).toBe(0);
    expect(database.query<{ count: number }, []>(`
      SELECT COUNT(*) AS count
      FROM saved_entities
      WHERE kind = 'regional_execution'
    `).get()?.count).toBe(0);
    expect(database.query<{ count: number }, []>(`
      SELECT COUNT(*) AS count FROM jobs WHERE id = 'job_recent_completion'
    `).get()?.count).toBe(0);
    expect(database.query<{ count: number }, []>(`
      SELECT COUNT(*) AS count
      FROM execution_jobs
      WHERE id = 'exec_recent_completion'
    `).get()?.count).toBe(0);
    database.close();
  });

  test('cleans derived resources from an intentionally partial schema', () => {
    const database = new Database(':memory:');
    database.exec(`
      CREATE TABLE saved_entities (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      );
      INSERT INTO saved_entities (kind, id, created_at, updated_at, payload_json)
      VALUES
        ('comparison', 'comparison_old', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'payload'),
        ('property', 'property_old', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'payload');
    `);

    expect(cleanupSqliteRetention(
      database,
      30,
      new Date('2026-07-22T00:00:00.000Z')
    )).toEqual({
      jobs: 0,
      checkRuns: 0,
      executionJobs: 0,
      derivedResources: 1,
      artifactIndexes: 0
    });
    expect(database.query<{ id: string }, []>('SELECT id FROM saved_entities').all())
      .toEqual([{ id: 'property_old' }]);
    database.close();
  });

  test('reports a missing database before maintenance', () => {
    const { databasePath } = createTempPaths();

    expect(() => maintainSqliteDatabase({
      databasePath,
      retentionDays: 30
    })).toThrow(`SQLite database does not exist: ${databasePath}`);
  });

  test('can create an automatic pre-migration backup for an existing legacy database', () => {
    const { directory, databasePath } = createTempPaths();
    const legacy = new Database(databasePath, { create: true });
    legacy.exec(`
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
    `);
    legacy.close();

    const repository = createSqliteJobRepository({
      databasePath,
      encryptionSecret,
      backupBeforeMigrations: true
    });
    repository.close();

    expect(readdirSync(directory).filter((name) => name.includes('.backup-'))).toHaveLength(1);
  });
});
