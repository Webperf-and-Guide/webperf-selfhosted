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
  restoreSqliteDatabase
} from '../src/database/operations';
import {
  applySqliteMigrations,
  IncompatibleSqliteSchemaError,
  openSqliteDatabase
} from '../src/database/sqlite';
import { sqliteMigrations } from '../src/database/migrations';
import { createStorageCrypto } from '../src/storage-crypto';
import { createSqliteJobRepository } from '../src/repository';

const tempDirectories: string[] = [];
const encryptionSecret = 'database-operations-test-secret';

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
    storageCrypto: createStorageCrypto({ currentSecret: encryptionSecret })
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
      'encrypted-placeholder'
    );

    backupSqliteDatabase({ databasePath, destinationPath: backupPath });
    database.query('UPDATE jobs SET status = ? WHERE id = ?').run('succeeded', 'job_restore');
    database.close();

    const restored = restoreSqliteDatabase({
      databasePath,
      sourcePath: backupPath,
      now: new Date('2026-07-22T12:00:00.000Z')
    });
    expect(restored.currentBackupPath).not.toBeNull();

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
      backupCurrent: false
    })).toThrow('missing required migrations');

    const result = restoreSqliteDatabase({
      databasePath,
      sourcePath: legacyPath,
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

  test('cleans only expired retained data and can run full maintenance', () => {
    const { databasePath } = createTempPaths();
    const { database } = migrateDatabase(databasePath);
    const insertJob = database.query(`
      INSERT INTO jobs (id, url, status, requested_at, updated_at, payload_json)
      VALUES (?, 'https://example.com/', 'succeeded', ?, ?, 'payload')
    `);
    insertJob.run('job_old', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z');
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
      derivedResources: 1,
      artifactIndexes: 1
    });
    expect(database.query<{ id: string }, []>('SELECT id FROM jobs ORDER BY id').all())
      .toEqual([{ id: 'job_active' }, { id: 'job_recent' }]);
    expect(database.query<{ id: string }, []>('SELECT id FROM saved_entities ORDER BY id').all())
      .toEqual([{ id: 'audit_active' }, { id: 'property_old' }]);
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
