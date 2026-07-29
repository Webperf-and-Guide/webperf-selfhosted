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
import { encryptedPayloadMigration } from './migrations/20260722_001_encrypted_payloads_v2';
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
  regionalTargetLinks: number;
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

const retentionDeleteBatchSize = 500;
export const defaultSqliteStorageCryptoVerificationLimit = 100_000;

const deleteRowsInBatches = (deleteBatch: () => unknown) => {
  let deleted = 0;

  while (true) {
    const changes = countChanges(deleteBatch());
    deleted += changes;
    if (changes < retentionDeleteBatchSize) {
      return deleted;
    }
  }
};

const cleanupRegionalExecutionGroups = (
  database: Database,
  cutoffIso: string
) => {
  const nextEligibleGroups = database.query<
    { id: string },
    [string, string, string, number]
  >(`
    SELECT entity.id
    FROM saved_entities AS entity
    WHERE entity.kind = 'regional_execution'
      AND entity.updated_at < ?
      AND NOT EXISTS (
        SELECT 1
        FROM regional_execution_targets AS target_link
        JOIN jobs AS job
          ON job.id = target_link.job_id
        WHERE target_link.regional_execution_id = entity.id
          AND (
            job.requested_at >= ?
            OR job.status NOT IN ('succeeded', 'failed', 'partial')
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM regional_execution_targets AS target_link
        JOIN execution_jobs AS execution
          ON execution.id = target_link.execution_job_id
        WHERE target_link.regional_execution_id = entity.id
          AND (
            execution.status NOT IN ('succeeded', 'failed', 'cancelled')
            OR execution.completed_at IS NULL
            OR execution.completed_at >= ?
          )
      )
    ORDER BY entity.updated_at ASC, entity.id ASC
    LIMIT ?
  `);
  const deleteJobs = database.query(`
    DELETE FROM jobs
    WHERE id IN (
      SELECT job_id
      FROM regional_execution_targets
      WHERE regional_execution_id = ?
    )
  `);
  const deleteExecutionJobs = database.query(`
    DELETE FROM execution_jobs
    WHERE id IN (
      SELECT execution_job_id
      FROM regional_execution_targets
      WHERE regional_execution_id = ?
    )
  `);
  const deleteTargetLinks = database.query(`
    DELETE FROM regional_execution_targets
    WHERE regional_execution_id = ?
  `);
  const deleteRegionalExecution = database.query(`
    DELETE FROM saved_entities
    WHERE kind = 'regional_execution'
      AND id = ?
  `);
  const deleteGroupBatch = database.transaction(() => {
    const candidates = nextEligibleGroups.all(
      cutoffIso,
      cutoffIso,
      cutoffIso,
      retentionDeleteBatchSize
    );
    let batchJobs = 0;
    let batchExecutionJobs = 0;
    let batchDerivedResources = 0;
    let batchRegionalTargetLinks = 0;

    for (const candidate of candidates) {
      batchJobs += countChanges(deleteJobs.run(candidate.id));
      batchExecutionJobs += countChanges(
        deleteExecutionJobs.run(candidate.id)
      );
      batchRegionalTargetLinks += countChanges(deleteTargetLinks.run(candidate.id));
      batchDerivedResources += countChanges(deleteRegionalExecution.run(candidate.id));
    }
    return {
      groupCount: candidates.length,
      jobs: batchJobs,
      executionJobs: batchExecutionJobs,
      derivedResources: batchDerivedResources,
      regionalTargetLinks: batchRegionalTargetLinks
    };
  });

  let jobs = 0;
  let executionJobs = 0;
  let derivedResources = 0;
  let regionalTargetLinks = 0;

  try {
    while (true) {
      const deleted = deleteGroupBatch.immediate();
      jobs += deleted.jobs;
      executionJobs += deleted.executionJobs;
      derivedResources += deleted.derivedResources;
      regionalTargetLinks += deleted.regionalTargetLinks;
      if (deleted.groupCount < retentionDeleteBatchSize) {
        return { jobs, executionJobs, derivedResources, regionalTargetLinks };
      }
    }
  } finally {
    nextEligibleGroups.finalize();
    deleteJobs.finalize();
    deleteExecutionJobs.finalize();
    deleteTargetLinks.finalize();
    deleteRegionalExecution.finalize();
  }
};

const tableExists = (database: Database, table: string) => Boolean(
  database
    .query<{ name: string }, [string]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
    )
    .get(table)
);
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
  let jobs = 0;
  let checkRuns = 0;
  let executionJobs = 0;
  let derivedResources = 0;
  let regionalTargetLinks = 0;
  let artifactIndexes = 0;

  const hasRegionalGroupTables = (
    tableExists(database, 'saved_entities')
    && tableExists(database, 'regional_execution_targets')
    && tableExists(database, 'jobs')
    && tableExists(database, 'execution_jobs')
  );
  if (hasRegionalGroupTables) {
    const regionalGroups = cleanupRegionalExecutionGroups(database, cutoffIso);
    jobs += regionalGroups.jobs;
    executionJobs += regionalGroups.executionJobs;
    derivedResources += regionalGroups.derivedResources;
    regionalTargetLinks += regionalGroups.regionalTargetLinks;
  }

  if (!hasRegionalGroupTables && tableExists(database, 'saved_entities')) {
    const statement = database.query<never, [string, number]>(`
      DELETE FROM saved_entities
      WHERE rowid IN (
        SELECT rowid
        FROM saved_entities
        WHERE kind = 'regional_execution'
          AND updated_at < ?
        LIMIT ?
      )
    `);
    try {
      derivedResources += deleteRowsInBatches(
        () => statement.run(cutoffIso, retentionDeleteBatchSize)
      );
    } finally {
      statement.finalize();
    }
  }

  if (tableExists(database, 'jobs')) {
    const statement = (
      tableExists(database, 'regional_execution_targets')
    )
      ? database.query<never, [string, number]>(`
      DELETE FROM jobs
      WHERE rowid IN (
        SELECT job.rowid
        FROM jobs AS job
        WHERE job.requested_at < ?
          AND job.status IN ('succeeded', 'failed', 'partial')
          AND NOT EXISTS (
            SELECT 1
            FROM regional_execution_targets AS target_link
            WHERE target_link.job_id = job.id
          )
        LIMIT ?
      )
    `)
      : database.query<never, [string, number]>(`
      DELETE FROM jobs
      WHERE rowid IN (
        SELECT rowid FROM jobs
        WHERE requested_at < ?
          AND status IN ('succeeded', 'failed', 'partial')
        LIMIT ?
      )
    `);
    try {
      jobs += deleteRowsInBatches(() => statement.run(cutoffIso, retentionDeleteBatchSize));
    } finally {
      statement.finalize();
    }
  }

  if (tableExists(database, 'check_profile_runs')) {
    const statement = database.query<never, [string, number]>(`
      DELETE FROM check_profile_runs
      WHERE rowid IN (
        SELECT rowid FROM check_profile_runs WHERE created_at < ? LIMIT ?
      )
    `);
    try {
      checkRuns = deleteRowsInBatches(() => statement.run(cutoffIso, retentionDeleteBatchSize));
    } finally {
      statement.finalize();
    }
  }

  if (tableExists(database, 'execution_jobs')) {
    const statement = tableExists(database, 'regional_execution_targets')
      ? database.query<never, [string, number]>(`
      DELETE FROM execution_jobs
      WHERE rowid IN (
        SELECT execution.rowid
        FROM execution_jobs AS execution
        WHERE execution.status IN ('succeeded', 'failed', 'cancelled')
          AND execution.completed_at < ?
          AND NOT EXISTS (
            SELECT 1
            FROM regional_execution_targets AS target_link
            WHERE target_link.execution_job_id = execution.id
          )
        LIMIT ?
      )
    `)
      : database.query<never, [string, number]>(`
      DELETE FROM execution_jobs
      WHERE rowid IN (
        SELECT rowid FROM execution_jobs
        WHERE status IN ('succeeded', 'failed', 'cancelled')
          AND completed_at < ?
        LIMIT ?
      )
    `);
    try {
      executionJobs += deleteRowsInBatches(
        () => statement.run(cutoffIso, retentionDeleteBatchSize)
      );
    } finally {
      statement.finalize();
    }
  }

  if (tableExists(database, 'saved_entities')) {
    const statement = tableExists(database, 'execution_jobs')
      ? database.query<never, [string, number]>(`
      DELETE FROM saved_entities
      WHERE rowid IN (
        SELECT entity.rowid
        FROM saved_entities AS entity
        WHERE entity.kind IN (
          'comparison',
          'export',
          'analysis',
          'browser_audit'
        )
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
        LIMIT ?
      )
    `)
      : database.query<never, [string, number]>(`
      DELETE FROM saved_entities
      WHERE rowid IN (
        SELECT rowid
        FROM saved_entities
        WHERE kind IN (
          'comparison',
          'export',
          'analysis',
          'browser_audit'
        )
          AND updated_at < ?
        LIMIT ?
      )
    `);
    try {
      derivedResources += deleteRowsInBatches(
        () => statement.run(cutoffIso, retentionDeleteBatchSize)
      );
    } finally {
      statement.finalize();
    }
  }

  if (
    tableExists(database, 'browser_audit_artifacts')
    && tableExists(database, 'saved_entities')
  ) {
    const statement = database.query<never, [number]>(`
      DELETE FROM browser_audit_artifacts
      WHERE rowid IN (
        SELECT artifact.rowid
        FROM browser_audit_artifacts AS artifact
        WHERE NOT EXISTS (
          SELECT 1
          FROM saved_entities AS entity
          WHERE entity.kind = 'browser_audit'
            AND entity.id = artifact.audit_id
        )
        LIMIT ?
      )
    `);
    try {
      artifactIndexes = deleteRowsInBatches(
        () => statement.run(retentionDeleteBatchSize)
      );
    } finally {
      statement.finalize();
    }
  }

  if (
    tableExists(database, 'regional_execution_targets')
    && tableExists(database, 'saved_entities')
  ) {
    const statement = database.query<never, [number]>(`
      DELETE FROM regional_execution_targets
      WHERE rowid IN (
        SELECT target_link.rowid
        FROM regional_execution_targets AS target_link
        WHERE NOT EXISTS (
          SELECT 1
          FROM saved_entities AS entity
          WHERE entity.kind = 'regional_execution'
            AND entity.id = target_link.regional_execution_id
        )
        LIMIT ?
      )
    `);
    try {
      regionalTargetLinks += deleteRowsInBatches(
        () => statement.run(retentionDeleteBatchSize)
      );
    } finally {
      statement.finalize();
    }
  }

  return {
    jobs,
    checkRuns,
    executionJobs,
    derivedResources,
    regionalTargetLinks,
    artifactIndexes
  };
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
  assertFileDatabase(databasePath);
  if (!existsSync(databasePath)) {
    throw new Error(`SQLite database does not exist: ${databasePath}`);
  }

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
  maximumPayloadsToVerify = defaultSqliteStorageCryptoVerificationLimit,
  now = new Date()
}: {
  databasePath: string;
  sourcePath: string;
  storageCrypto: StorageCrypto;
  backupCurrent?: boolean;
  allowPendingMigrations?: boolean;
  maximumPayloadsToVerify?: number;
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

    const verifiedEncryptedPayloads = sourceMigrations.applied.some(
      (migration) => migration.id === encryptedPayloadMigration.id
    )
      ? verifySqliteStorageCrypto(source, storageCrypto, {
          maximumPayloads: maximumPayloadsToVerify
        })
      : 0;

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

    // Restore is intentionally offline: the operator docs and CLI workflow
    // require API, scheduler, and executor writers to be stopped before these
    // WAL sidecars are removed and the destination inode is replaced.
    for (const sidecarPath of [`${databasePath}-wal`, `${databasePath}-shm`, `${databasePath}-journal`]) {
      rmSync(sidecarPath, { force: true });
    }

    renameSync(temporaryPath, databasePath);
    temporaryPath = null;
    return {
      databasePath,
      sourcePath,
      currentBackupPath,
      verifiedEncryptedPayloads,
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
  storageCrypto: StorageCrypto,
  {
    maximumPayloads = defaultSqliteStorageCryptoVerificationLimit
  }: {
    maximumPayloads?: number;
  } = {}
) => {
  if (!Number.isSafeInteger(maximumPayloads) || maximumPayloads < 1) {
    throw new Error('SQLite payload verification limit must be a positive integer');
  }

  let checkedPayloads = 0;

  for (const { table, column } of persistedPayloadColumns) {
    if (!tableExists(database, table)) {
      continue;
    }

    let lastRowId: number | null = null;
    const readFirstBatch = database.query<
      { row_id: number; encrypted_value: string },
      []
    >(`
      SELECT rowid AS row_id, ${column} AS encrypted_value
      FROM ${table}
      WHERE ${column} IS NOT NULL
      ORDER BY rowid
      LIMIT 100
    `);
    const readNextBatch = database.query<
      { row_id: number; encrypted_value: string },
      [number]
    >(`
      SELECT rowid AS row_id, ${column} AS encrypted_value
      FROM ${table}
      WHERE rowid > ? AND ${column} IS NOT NULL
      ORDER BY rowid
      LIMIT 100
    `);

    try {
      while (true) {
        const rows: Array<{ row_id: number; encrypted_value: string }> = lastRowId === null
          ? readFirstBatch.all()
          : readNextBatch.all(lastRowId);
        if (rows.length === 0) {
          break;
        }

        for (const row of rows) {
          if (checkedPayloads >= maximumPayloads) {
            throw new Error(
              `SQLite restore source exceeds the encrypted payload verification limit of ${maximumPayloads}`
            );
          }

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
    } finally {
      readFirstBatch.finalize();
      readNextBatch.finalize();
    }
  }

  return checkedPayloads;
};
