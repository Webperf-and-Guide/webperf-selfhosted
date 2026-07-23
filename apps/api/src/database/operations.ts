import type { Database } from 'bun:sqlite';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSqliteMigrationState, openSqliteDatabase } from './sqlite';
import type { StorageCrypto } from '../storage-crypto';

export type SqliteIntegrityReport = {
  ok: boolean;
  integrityMessages: string[];
  foreignKeyViolations: number;
};

export type SqliteRetentionResult = {
  jobs: number;
  checkRuns: number;
  executionJobs: number;
  derivedResources: number;
  artifactIndexes: number;
};

export type SqliteDoctorReport = {
  ok: boolean;
  databasePath: string;
  sizeBytes: number;
  journalMode: string;
  busyTimeoutMs: number;
  foreignKeys: boolean;
  migrations: ReturnType<typeof getSqliteMigrationState>;
  integrity: SqliteIntegrityReport;
};

type IntegrityRow = {
  integrity_check: string;
};

const assertFileDatabase = (databasePath: string) => {
  if (databasePath === ':memory:') {
    throw new Error('This operation requires a file-backed SQLite database');
  }
};

const countChanges = (result: unknown) =>
  (result as { changes?: number }).changes ?? 0;

const tableExists = (database: Database, table: string) => Boolean(
  database
    .query<{ name: string }, [string]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
    )
    .get(table)
);
const encryptedPayloadMigrationId = '20260722_001_encrypted_payloads_v2';
const persistedPayloadColumns = [
  { table: 'jobs', column: 'payload_json' },
  { table: 'saved_entities', column: 'payload_json' },
  { table: 'check_profile_runs', column: 'payload_json' },
  { table: 'execution_jobs', column: 'payload_json' },
  { table: 'execution_jobs', column: 'error_json' }
] as const;

export const defaultSqliteBackupPath = (databasePath: string, now = new Date()) => {
  assertFileDatabase(databasePath);
  const timestamp = now.toISOString().replaceAll(/[-:.TZ]/g, '');
  return `${databasePath}.backup-${timestamp}`;
};

// Bun's prepared statement API supports binding VACUUM INTO filenames. Keeping
// the path bound avoids SQL interpolation; backup and restore tests exercise it
// against WAL-visible data on the pinned Bun runtime.
const vacuumInto = (database: Database, destinationPath: string) => {
  database.query('VACUUM INTO ?').run(destinationPath);
};

export const createSqliteBackupFromConnection = (
  database: Database,
  destinationPath: string
) => {
  if (existsSync(destinationPath)) {
    throw new Error(`Refusing to overwrite existing SQLite backup: ${destinationPath}`);
  }

  mkdirSync(dirname(destinationPath), { recursive: true });
  const temporaryPath = `${destinationPath}.tmp-${randomUUID()}`;
  let published = false;

  try {
    vacuumInto(database, temporaryPath);
    chmodSync(temporaryPath, 0o600);
    const backup = openSqliteDatabase(temporaryPath, { readonly: true, create: false });
    let integrity: SqliteIntegrityReport;

    try {
      integrity = inspectSqliteIntegrity(backup);
    } finally {
      backup.close();
    }

    if (!integrity.ok) {
      throw new Error(`SQLite backup failed integrity verification: ${integrity.integrityMessages.join('; ')}`);
    }

    try {
      linkSync(temporaryPath, destinationPath);
      published = true;
      chmodSync(destinationPath, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`Refusing to overwrite existing SQLite backup: ${destinationPath}`);
      }

      throw error;
    }
  } catch (error) {
    if (published) {
      rmSync(destinationPath, { force: true });
    }

    throw error;
  } finally {
    rmSync(temporaryPath, { force: true });
  }

  return destinationPath;
};

export const backupSqliteDatabase = ({
  databasePath,
  destinationPath = defaultSqliteBackupPath(databasePath)
}: {
  databasePath: string;
  destinationPath?: string;
}) => {
  assertFileDatabase(databasePath);

  if (!existsSync(databasePath)) {
    throw new Error(`SQLite database does not exist: ${databasePath}`);
  }

  if (resolve(databasePath) === resolve(destinationPath)) {
    throw new Error('SQLite backup destination must differ from the source database');
  }

  const database = openSqliteDatabase(databasePath, { readonly: true, create: false });

  try {
    return createSqliteBackupFromConnection(database, destinationPath);
  } finally {
    database.close();
  }
};

export const inspectSqliteIntegrity = (database: Database): SqliteIntegrityReport => {
  const integrityMessages = database
    .query<IntegrityRow, []>('PRAGMA integrity_check')
    .all()
    .map((row) => row.integrity_check);
  const foreignKeyViolations = database
    .query<Record<string, unknown>, []>('PRAGMA foreign_key_check')
    .all()
    .length;

  return {
    ok: integrityMessages.length === 1
      && integrityMessages[0]?.toLowerCase() === 'ok'
      && foreignKeyViolations === 0,
    integrityMessages,
    foreignKeyViolations
  };
};

export const doctorSqliteDatabase = (databasePath: string): SqliteDoctorReport => {
  assertFileDatabase(databasePath);

  if (!existsSync(databasePath)) {
    throw new Error(`SQLite database does not exist: ${databasePath}`);
  }

  const database = openSqliteDatabase(databasePath, { readonly: true, create: false });

  try {
    const integrity = inspectSqliteIntegrity(database);
    const journalMode = database
      .query<{ journal_mode: string }, []>('PRAGMA journal_mode')
      .get()?.journal_mode ?? 'unknown';
    const busyTimeoutMs = database
      .query<{ timeout: number }, []>('PRAGMA busy_timeout')
      .get()?.timeout ?? 0;
    const foreignKeys = database
      .query<{ foreign_keys: number }, []>('PRAGMA foreign_keys')
      .get()?.foreign_keys === 1;
    const migrations = getSqliteMigrationState(database);

    return {
      ok: integrity.ok
        && journalMode.toLowerCase() === 'wal'
        && busyTimeoutMs === 5_000
        && foreignKeys
        && migrations.pending.length === 0
        && migrations.unknown.length === 0,
      databasePath,
      sizeBytes: statSync(databasePath).size,
      journalMode,
      busyTimeoutMs,
      foreignKeys,
      migrations,
      integrity
    };
  } finally {
    database.close();
  }
};

export const cleanupSqliteRetention = (
  database: Database,
  retentionDays: number,
  now = new Date()
): SqliteRetentionResult => {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1) {
    throw new Error('SQLite retention days must be a positive integer');
  }

  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  const cutoffIso = cutoff.toISOString();
  const cleanup = database.transaction((): SqliteRetentionResult => {
    const jobs = tableExists(database, 'jobs')
      ? countChanges(database.query(`
          DELETE FROM jobs
          WHERE requested_at < ?
            AND status IN ('succeeded', 'failed', 'partial')
        `).run(cutoffIso))
      : 0;
    const checkRuns = tableExists(database, 'check_profile_runs')
      ? countChanges(database.query('DELETE FROM check_profile_runs WHERE created_at < ?').run(cutoffIso))
      : 0;
    const executionJobs = tableExists(database, 'execution_jobs')
      ? countChanges(database.query(`
          DELETE FROM execution_jobs
          WHERE status IN ('succeeded', 'failed', 'cancelled')
            AND completed_at < ?
        `).run(cutoffIso))
      : 0;
    const derivedResources = tableExists(database, 'saved_entities')
      ? countChanges(database.query(`
          DELETE FROM saved_entities AS entity
          WHERE entity.kind IN ('comparison', 'export', 'analysis', 'browser_audit')
            AND entity.updated_at < ?
            AND (
              entity.kind != 'browser_audit'
              OR NOT EXISTS (
                SELECT 1
                FROM execution_jobs AS execution
                WHERE execution.kind = 'browser_audit'
                  AND execution.resource_id = entity.id
                  -- Active work intentionally survives retention so a stopped
                  -- executor can resume it even after a long operator outage.
                  AND execution.status IN ('queued', 'leased', 'running')
              )
            )
        `).run(cutoffIso))
      : 0;
    const artifactIndexes = tableExists(database, 'browser_audit_artifacts')
      && tableExists(database, 'saved_entities')
      ? countChanges(database.query(`
          DELETE FROM browser_audit_artifacts AS artifact
          WHERE NOT EXISTS (
            SELECT 1
            FROM saved_entities AS entity
            WHERE entity.kind = 'browser_audit'
              AND entity.id = artifact.audit_id
          )
        `).run())
      : 0;

    return { jobs, checkRuns, executionJobs, derivedResources, artifactIndexes };
  });

  return cleanup.immediate();
};

export const maintainSqliteDatabase = ({
  databasePath,
  retentionDays,
  vacuum = false,
  now = new Date()
}: {
  databasePath: string;
  retentionDays: number;
  vacuum?: boolean;
  now?: Date;
}) => {
  const database = openSqliteDatabase(databasePath, { create: false });

  try {
    const retention = cleanupSqliteRetention(database, retentionDays, now);
    database.exec('PRAGMA optimize;');

    if (vacuum) {
      database.exec('VACUUM;');
    }

    const checkpoint = database
      .query<{ busy: number; log: number; checkpointed: number }, []>('PRAGMA wal_checkpoint(TRUNCATE)')
      .get() ?? { busy: 0, log: 0, checkpointed: 0 };

    return { retention, vacuumed: vacuum, checkpoint };
  } finally {
    database.close();
  }
};

export const restoreSqliteDatabase = ({
  databasePath,
  sourcePath,
  storageCrypto,
  backupCurrent = true,
  allowPendingMigrations = false,
  now = new Date()
}: {
  databasePath: string;
  sourcePath: string;
  storageCrypto: StorageCrypto;
  backupCurrent?: boolean;
  allowPendingMigrations?: boolean;
  now?: Date;
}) => {
  assertFileDatabase(databasePath);

  if (!existsSync(sourcePath)) {
    throw new Error(`SQLite restore source does not exist: ${sourcePath}`);
  }

  if (resolve(databasePath) === resolve(sourcePath)) {
    throw new Error('SQLite restore source must differ from the destination database');
  }

  const source = openSqliteDatabase(sourcePath, { readonly: true, create: false });
  let sourceClosed = false;
  const closeSource = () => {
    if (!sourceClosed) {
      sourceClosed = true;
      source.close();
    }
  };
  let temporaryPath: string | null = null;

  try {
    const sourceIntegrity = inspectSqliteIntegrity(source);

    if (!sourceIntegrity.ok) {
      throw new Error(`SQLite restore source failed integrity verification: ${sourceIntegrity.integrityMessages.join('; ')}`);
    }

    const sourceMigrations = getSqliteMigrationState(source);

    if (sourceMigrations.unknown.length > 0) {
      throw new Error(
        `SQLite restore source contains migrations unknown to this WebPerf version: ${sourceMigrations.unknown.join(', ')}`
      );
    }

    if (sourceMigrations.pending.length > 0 && !allowPendingMigrations) {
      throw new Error(
        `SQLite restore source is missing required migrations: ${sourceMigrations.pending.join(', ')}`
      );
    }

    if (sourceMigrations.applied.some((migration) => migration.id === encryptedPayloadMigrationId)) {
      verifySqliteStorageCrypto(source, storageCrypto);
    }

    const currentBackupPath = backupCurrent && existsSync(databasePath)
      ? backupSqliteDatabase({
          databasePath,
          destinationPath: defaultSqliteBackupPath(databasePath, now)
        })
      : null;
    mkdirSync(dirname(databasePath), { recursive: true });
    temporaryPath = `${databasePath}.restore-${randomUUID()}.tmp`;
    vacuumInto(source, temporaryPath);
    closeSource();
    chmodSync(temporaryPath, 0o600);

    const temporary = openSqliteDatabase(temporaryPath, { readonly: true, create: false });
    let temporaryIntegrity: SqliteIntegrityReport;

    try {
      temporaryIntegrity = inspectSqliteIntegrity(temporary);
    } finally {
      temporary.close();
    }

    if (!temporaryIntegrity.ok) {
      throw new Error(`SQLite restored snapshot failed integrity verification: ${temporaryIntegrity.integrityMessages.join('; ')}`);
    }

    for (const sidecarPath of [`${databasePath}-wal`, `${databasePath}-shm`, `${databasePath}-journal`]) {
      rmSync(sidecarPath, { force: true });
    }

    renameSync(temporaryPath, databasePath);
    temporaryPath = null;
    chmodSync(databasePath, 0o600);
    return {
      databasePath,
      sourcePath,
      currentBackupPath,
      pendingMigrationIds: sourceMigrations.pending
    };
  } catch (error) {
    if (temporaryPath) {
      rmSync(temporaryPath, { force: true });
    }

    throw error;
  } finally {
    closeSource();
  }
};

export const verifySqliteStorageCrypto = (
  database: Database,
  storageCrypto: StorageCrypto
) => {
  let checkedPayloads = 0;

  for (const { table, column } of persistedPayloadColumns) {
    if (!tableExists(database, table)) {
      continue;
    }

    let lastRowId: string | null = null;
    const readFirstBatch = database.query<
      { row_id: string; encrypted_value: string },
      []
    >(`
      SELECT CAST(rowid AS TEXT) AS row_id, ${column} AS encrypted_value
      FROM ${table}
      WHERE ${column} IS NOT NULL
      ORDER BY rowid
      LIMIT 100
    `);
    const readNextBatch = database.query<
      { row_id: string; encrypted_value: string },
      [string]
    >(`
      SELECT CAST(rowid AS TEXT) AS row_id, ${column} AS encrypted_value
      FROM ${table}
      WHERE rowid > CAST(? AS INTEGER) AND ${column} IS NOT NULL
      ORDER BY rowid
      LIMIT 100
    `);

    while (true) {
      const rows: Array<{ row_id: string; encrypted_value: string }> = lastRowId === null
        ? readFirstBatch.all()
        : readNextBatch.all(lastRowId);
      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        try {
          storageCrypto.parse(row.encrypted_value);
        } catch (cause) {
          throw new Error(
            `SQLite restore source contains a payload incompatible with the configured internal secret (${table}.${column}, rowid ${row.row_id})`,
            { cause }
          );
        }
        checkedPayloads += 1;
        lastRowId = row.row_id;
      }
    }
  }

  return checkedPayloads;
};
