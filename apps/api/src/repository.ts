import type {
  AnalysisResource,
  BrowserAuditArtifactKind,
  BrowserAuditArtifactRef,
  BrowserAuditResource,
  CheckProfile,
  CheckProfileAlertDelivery,
  CheckProfileRun,
  ComparisonResource,
  EnqueueExecutionJob,
  ExecutionJob,
  ExecutionJobError,
  ExecutionResourceResult,
  ExportResource,
  LatencyJob,
  LatencyJobDetail,
  Property,
  RuntimeExecutionQueueMetrics,
  RuntimeExecutionStatusCounts,
  RouteSet
} from '@webperf/contracts';
import {
  analysisResourceSchema,
  browserAuditArtifactContentTypesForKind,
  browserAuditArtifactLimit,
  browserAuditArtifactLocatorSchema,
  browserAuditArtifactRefSchema,
  browserAuditArtifactRegistryVersion,
  browserAuditResourceSchema,
  checkProfileSchema,
  checkProfileRunSchema,
  comparisonResourceSchema,
  defaultExecutionRetryDelayMs,
  enqueueExecutionJobSchema,
  executionAvailabilityMaxDelayDays,
  executionAvailabilityMaxDelayMs,
  executionJobErrorSchema,
  executionJobKindValues,
  executionJobSchema,
  executionJobStatusValues,
  executionLeaseDurationMaxMs,
  executionLeaseDurationMinMs,
  executionLeaseOwnerMaxLength,
  executionRetryDelayMaxMs,
  exportResourceSchema,
  latencyJobDetailSchema,
  networkProbeExecutionPayloadSchema,
  propertySchema,
  routeSetSchema
} from '@webperf/contracts';
import type { Database } from 'bun:sqlite';
import { existsSync, statSync } from 'node:fs';
import {
  createStorageCrypto,
  InvalidEncryptedPayloadEnvelopeError,
  UnencryptedPersistedPayloadError
} from './storage-crypto';
import { redactUrlQuery } from './redaction';
import {
  cleanupSqliteRetention,
  createSqliteBackupFromConnection,
  defaultSqliteBackupPath,
  type SqliteRetentionResult
} from './database/operations';
import { applySqliteMigrations, openSqliteDatabase } from './database/sqlite';
import { browserAuditArtifactLimitTriggerName } from './database/migrations/20260722_003_browser_audit_artifacts';
import {
  regionalExecutionRecordSchema,
  type RegionalExecutionRecord
} from './regional-runtime-record';

// Must stay in sync with the immutable trigger threshold in migration
// 20260722_003_browser_audit_artifacts.
const maximumBrowserAuditArtifactsPerAudit = browserAuditArtifactLimit;
const browserAuditArtifactLimitConstraintMarker = 'browser_audit_artifact_limit';
export const executionExhaustionFinalizationBatchSize = 50;

const assertBrowserAuditArtifactLimitTrigger = (database: Database) => {
  const definition = database.query<{ sql: string | null }, [string]>(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'trigger' AND name = ?
    LIMIT 1
  `).get(browserAuditArtifactLimitTriggerName)?.sql;
  const triggerSql = definition ?? '';
  const threshold = triggerSql.match(
    /where\s+audit_id\s*=\s*new\.audit_id\s*\)\s*>=\s*(\d+)/i
  )?.[1];
  const valid = /before\s+insert\s+on\s+browser_audit_artifacts/i.test(triggerSql)
    && new RegExp(
      `raise\\s*\\(\\s*abort\\s*,\\s*['"]${browserAuditArtifactLimitConstraintMarker}['"]\\s*\\)`,
      'i'
    ).test(triggerSql)
    && Number(threshold) === maximumBrowserAuditArtifactsPerAudit;

  if (!valid) {
    throw new Error(
      'Browser Audit artifact limit trigger must enforce exactly '
      + `${maximumBrowserAuditArtifactsPerAudit} artifacts per audit`
    );
  }
};

export const isBrowserAuditArtifactLimitConstraint = (error: unknown) => {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  return typeof candidate?.code === 'string'
    && candidate.code.startsWith('SQLITE_CONSTRAINT')
    && typeof candidate.message === 'string'
    && candidate.message.includes(browserAuditArtifactLimitConstraintMarker);
};

type JobRow = {
  id: string;
  payload_json: string;
};

export type JobRepository = {
  getJob(id: string): LatencyJobDetail | null;
  listJobs(): LatencyJob[];
  saveJob(job: LatencyJobDetail): void;
  pruneJobsOlderThan(retentionDays: number, now?: Date): number;
  pruneRetainedData(retentionDays: number, now?: Date): SqliteRetentionResult;
  countJobs(): number;
  getProperty(id: string): Property | null;
  listProperties(): Property[];
  saveProperty(property: Property): void;
  deleteProperty(id: string): boolean;
  getRouteSet(id: string): RouteSet | null;
  listRouteSets(): RouteSet[];
  saveRouteSet(routeSet: RouteSet): void;
  deleteRouteSet(id: string): boolean;
  getCheckProfile(id: string): CheckProfile | null;
  listCheckProfiles(): CheckProfile[];
  saveCheckProfile(checkProfile: CheckProfile): void;
  deleteCheckProfile(id: string): { deleted: boolean; deletedRunCount: number };
  getCheckProfileRun(id: string): CheckProfileRun | null;
  listCheckProfileRuns(profileId: string): CheckProfileRun[];
  saveCheckProfileRun(run: CheckProfileRun): void;
  getComparison(id: string): ComparisonResource | null;
  listComparisons(): ComparisonResource[];
  saveComparison(comparison: ComparisonResource): void;
  getExport(id: string): ExportResource | null;
  listExports(): ExportResource[];
  saveExport(exportResource: ExportResource): void;
  getAnalysis(id: string): AnalysisResource | null;
  listAnalyses(): AnalysisResource[];
  saveAnalysis(analysis: AnalysisResource): void;
  getBrowserAudit(id: string): BrowserAuditResource | null;
  listBrowserAudits(): BrowserAuditResource[];
  saveBrowserAudit(browserAudit: BrowserAuditResource): void;
  saveBrowserAuditArtifact(artifact: BrowserAuditArtifactRecord): boolean;
  getBrowserAuditArtifact(auditId: string, artifactId: string): BrowserAuditArtifactRecord | null;
  listBrowserAuditArtifacts(auditId: string): BrowserAuditArtifactRecord[];
  listBrowserAuditArtifactStorageKeys(): string[];
  getRegionalExecution(id: string): RegionalExecutionRecord | null;
  createRegionalExecution(input: {
    record: RegionalExecutionRecord;
    resources: Array<{
      executionJob: EnqueueExecutionJob;
      result: ExecutionResourceResult;
    }>;
  }, now?: Date): {
    record: RegionalExecutionRecord;
    created: boolean;
  };
  saveRegionalExecution(record: RegionalExecutionRecord): void;
  terminateRegionalExecution(input: {
    id: string;
    reason: 'cancelled' | 'deadline_exceeded';
  }, now?: Date): RegionalExecutionRecord | null;
  createExecutionResource(input: {
    executionJob: EnqueueExecutionJob;
    result: ExecutionResourceResult;
  }, now?: Date): ExecutionJob;
  saveExecutionResourceResult(input: {
    executionJobId: string;
    leaseOwner: string;
    result: ExecutionResourceResult;
  }, now?: Date): boolean;
  enqueueExecutionJob(input: EnqueueExecutionJob, now?: Date): ExecutionJob;
  enqueueExecutionJobs(input: {
    executionJobId: string;
    leaseOwner: string;
    jobs: EnqueueExecutionJob[];
  }, now?: Date): ExecutionJob[] | null;
  getExecutionJob(id: string): ExecutionJob | null;
  listExecutionJobs(): ExecutionJob[];
  getExecutionQueueMetrics(
    now: Date,
    terminalCountsBoundedDays: number
  ): RuntimeExecutionQueueMetrics;
  claimExecutionJob(input: ExecutionJobClaimInput, now?: Date): ExecutionJob | null;
  markExecutionJobRunning(input: ExecutionJobLeaseInput & { id: string }, now?: Date): ExecutionJob | null;
  renewExecutionJobLease(input: ExecutionJobLeaseInput & { id: string }, now?: Date): ExecutionJob | null;
  completeExecutionJob(input: ExecutionJobOwnerInput, now?: Date): ExecutionJob | null;
  failExecutionJob(input: ExecutionJobOwnerInput & {
    error: ExecutionJobError;
    retryDelayMs?: number;
  }, now?: Date): ExecutionJob | null;
  cancelExecutionJob(id: string, now?: Date): ExecutionJob | null;
  close(): void;
};

export type ExecutionJobLeaseInput = {
  leaseOwner: string;
  leaseDurationMs: number;
};

export type ExecutionJobClaimInput = ExecutionJobLeaseInput & {
  kind?: ExecutionJob['kind'];
};

export type ExecutionJobOwnerInput = {
  id: string;
  leaseOwner: string;
};

export type BrowserAuditArtifactRecord = {
  id: string;
  auditId: string;
  registryVersion: BrowserAuditArtifactRef['registryVersion'];
  kind: BrowserAuditArtifactKind;
  filename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  storageKey: string;
  createdAt: string;
};

type EntityKind =
  | 'property'
  | 'route_set'
  | 'check_profile'
  | 'comparison'
  | 'export'
  | 'analysis'
  | 'browser_audit'
  | 'regional_execution';

type SavedEntityRow = {
  payload_json: string;
};

type CheckProfileRunRow = {
  payload_json: string;
};

type ExecutionJobRow = {
  id: string;
  kind: string;
  resource_id: string;
  status: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  attempt_count: number;
  max_attempts: number;
  available_at: string;
  payload_json: string;
  error_json: string | null;
  created_at: string;
  started_at: string | null;
  updated_at: string;
  completed_at: string | null;
};

type ExecutionMetricCountRow = {
  kind: string;
  status: string;
  count: number;
};

type ExecutionPressureRow = {
  ready: number;
  delayed: number;
  active: number;
  expired_leases: number;
  retry_queued: number;
  exhausted: number;
  oldest_ready_at: string | null;
  oldest_active_at: string | null;
};

type BrowserAuditArtifactRow = {
  id: string;
  audit_id: string;
  registry_version: string;
  kind: string;
  filename: string;
  content_type: string;
  byte_size: number;
  sha256: string;
  storage_key: string;
  created_at: string;
};

type BrowserAuditArtifactCandidate = {
  id: unknown;
  auditId: unknown;
  registryVersion: unknown;
  kind: unknown;
  filename: unknown;
  contentType: unknown;
  byteSize: unknown;
  sha256: unknown;
  storageKey: unknown;
  createdAt: unknown;
};

const browserAuditArtifactMetadataSchema = browserAuditArtifactRefSchema.omit({ url: true });

const normalizeBrowserAuditArtifactRecord = (
  artifact: BrowserAuditArtifactCandidate
): BrowserAuditArtifactRecord | null => {
  const locator = browserAuditArtifactLocatorSchema.safeParse({
    auditId: artifact.auditId,
    artifactId: artifact.id
  });
  const reference = browserAuditArtifactMetadataSchema.safeParse({
    id: artifact.id,
    registryVersion: artifact.registryVersion,
    kind: artifact.kind,
    filename: artifact.filename,
    contentType: artifact.contentType,
    byteSize: artifact.byteSize,
    sha256: artifact.sha256,
    createdAt: artifact.createdAt
  });

  if (
    !locator.success
    || !reference.success
    || artifact.registryVersion !== browserAuditArtifactRegistryVersion
    || reference.data.filename === null
    || reference.data.byteSize === null
    || reference.data.sha256 === null
    || typeof artifact.storageKey !== 'string'
    || artifact.storageKey !== `${locator.data.auditId}/${locator.data.artifactId}`
    || !browserAuditArtifactContentTypesForKind(reference.data.kind)
      .includes(reference.data.contentType)
  ) {
    return null;
  }

  return {
    id: locator.data.artifactId,
    auditId: locator.data.auditId,
    registryVersion: reference.data.registryVersion,
    kind: reference.data.kind,
    filename: reference.data.filename,
    contentType: reference.data.contentType,
    byteSize: reference.data.byteSize,
    sha256: reference.data.sha256,
    storageKey: artifact.storageKey,
    createdAt: reference.data.createdAt
  };
};

type JsonSchema<T> = {
  parse(value: unknown): T;
};

export const createSqliteJobRepository = ({
  databasePath,
  encryptionSecret,
  encryptionSecretNext,
  backupBeforeMigrations = false,
  runtimeRegionId
}: {
  databasePath: string;
  encryptionSecret: string;
  encryptionSecretNext?: string;
  backupBeforeMigrations?: boolean;
  runtimeRegionId?: string;
}): JobRepository => {
  const shouldBackupBeforeMigrations = backupBeforeMigrations
    && databasePath !== ':memory:'
    && existsSync(databasePath)
    && statSync(databasePath).size > 0;
  const db = openSqliteDatabase(databasePath);
  const storageCrypto = createStorageCrypto({
    currentSecret: encryptionSecret,
    nextSecret: encryptionSecretNext
  });
  let migrationResult: ReturnType<typeof applySqliteMigrations>;

  try {
    migrationResult = applySqliteMigrations(
      db,
      { storageCrypto, runtimeRegionId },
      shouldBackupBeforeMigrations
        ? {
            beforeMigrate() {
              const backupPath = defaultSqliteBackupPath(databasePath);
              createSqliteBackupFromConnection(db, backupPath);
              console.log(JSON.stringify({
                service: 'webperf-api',
                event: 'sqlite.pre_migration_backup.created',
                backupPath
              }));
            }
          }
        : undefined
    );
    assertBrowserAuditArtifactLimitTrigger(db);
  } catch (error) {
    db.close();
    throw error;
  }

  if (migrationResult.appliedNow.length > 0) {
    console.log(JSON.stringify({
      service: 'webperf-api',
      event: 'sqlite.migrations.applied',
      migrationIds: migrationResult.appliedNow
    }));
  }

  const saveStatement = db.query(`
    INSERT INTO jobs (id, url, status, requested_at, updated_at, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      url = excluded.url,
      status = excluded.status,
      requested_at = excluded.requested_at,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `);
  const getStatement = db.query<JobRow, [string]>(`
    SELECT id, payload_json
    FROM jobs
    WHERE id = ?
    LIMIT 1
  `);
  const listStatement = db.query<JobRow, []>(`
    SELECT id, payload_json
    FROM jobs
    ORDER BY requested_at DESC
  `);
  const pruneStatement = db.query(`
    DELETE FROM jobs
    WHERE requested_at < ?
      AND status IN ('succeeded', 'failed', 'partial')
  `);
  const countStatement = db.query<{ count: number }, []>(`
    SELECT COUNT(*) as count
    FROM jobs
  `);
  const saveEntityStatement = db.query(`
    INSERT INTO saved_entities (kind, id, created_at, updated_at, payload_json)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(kind, id) DO UPDATE SET
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `);
  const getEntityStatement = db.query<SavedEntityRow, [EntityKind, string]>(`
    SELECT payload_json
    FROM saved_entities
    WHERE kind = ?
      AND id = ?
    LIMIT 1
  `);
  const listEntityStatement = db.query<SavedEntityRow, [EntityKind]>(`
    SELECT payload_json
    FROM saved_entities
    WHERE kind = ?
    ORDER BY updated_at DESC
  `);
  const deleteEntityStatement = db.query(`
    DELETE FROM saved_entities
    WHERE kind = ?
      AND id = ?
  `);
  const saveRegionalExecutionTargetStatement = db.query(`
    INSERT INTO regional_execution_targets (
      regional_execution_id,
      execution_job_id,
      job_id
    ) VALUES (?, ?, ?)
    ON CONFLICT (regional_execution_id, job_id) DO UPDATE SET
      execution_job_id = excluded.execution_job_id
  `);
  const saveCheckProfileRunStatement = db.query(`
    INSERT INTO check_profile_runs (id, profile_id, created_at, payload_json)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      profile_id = excluded.profile_id,
      created_at = excluded.created_at,
      payload_json = excluded.payload_json
  `);
  const getCheckProfileRunStatement = db.query<CheckProfileRunRow, [string]>(`
    SELECT payload_json
    FROM check_profile_runs
    WHERE id = ?
    LIMIT 1
  `);
  const listCheckProfileRunsStatement = db.query<CheckProfileRunRow, [string]>(`
    SELECT payload_json
    FROM check_profile_runs
    WHERE profile_id = ?
    ORDER BY created_at DESC
  `);
  const deleteCheckProfileRunsStatement = db.query(`
    DELETE FROM check_profile_runs
    WHERE profile_id = ?
  `);
  const saveBrowserAuditArtifactStatement = db.query(`
    INSERT INTO browser_audit_artifacts (
      id, audit_id, registry_version, kind, filename, content_type,
      byte_size, sha256, storage_key, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO NOTHING
  `);
  const countBrowserAuditArtifactsStatement = db.query<{ count: number }, [string]>(`
    SELECT COUNT(*) AS count
    FROM browser_audit_artifacts
    WHERE audit_id = ?
  `);
  const getBrowserAuditArtifactStatement = db.query<BrowserAuditArtifactRow, [string, string]>(`
    SELECT *
    FROM browser_audit_artifacts
    WHERE audit_id = ? AND id = ?
    LIMIT 1
  `);
  const listBrowserAuditArtifactsStatement = db.query<BrowserAuditArtifactRow, [string]>(`
    SELECT *
    FROM browser_audit_artifacts
    WHERE audit_id = ?
    ORDER BY created_at, id
  `);
  const listBrowserAuditArtifactStorageKeysStatement = db.query<{ storage_key: string }, []>(`
    SELECT storage_key
    FROM browser_audit_artifacts
    ORDER BY storage_key
  `);
  const enqueueExecutionJobStatement = db.query<ExecutionJobRow, [
    string,
    string,
    string,
    number,
    string,
    string,
    string,
    string
  ]>(`
    INSERT INTO execution_jobs (
      id, kind, resource_id, status, lease_owner, lease_expires_at,
      attempt_count, max_attempts, available_at, payload_json, error_json,
      created_at, updated_at, completed_at
    )
    VALUES (?, ?, ?, 'queued', NULL, NULL, 0, ?, ?, ?, NULL, ?, ?, NULL)
    ON CONFLICT(id) DO NOTHING
    RETURNING *
  `);
  const getExecutionJobStatement = db.query<ExecutionJobRow, [string]>(`
    SELECT *
    FROM execution_jobs
    WHERE id = ?
    LIMIT 1
  `);
  const listExecutionJobsStatement = db.query<ExecutionJobRow, []>(`
    SELECT *
    FROM execution_jobs
    ORDER BY created_at DESC, id DESC
  `);
  const executionMetricCountsStatement = db.query<ExecutionMetricCountRow, [string]>(`
    SELECT kind, status, COUNT(*) AS count
    FROM execution_jobs
    WHERE status NOT IN ('succeeded', 'failed', 'cancelled')
      OR completed_at >= ?
    GROUP BY kind, status
    ORDER BY kind, status
  `);
  const executionPressureStatement = db.query<ExecutionPressureRow, [string]>(`
    WITH metric_clock(now) AS (VALUES (?))
    SELECT
      COALESCE(SUM(CASE
        WHEN attempt_count < max_attempts
          AND (
            (status = 'queued' AND available_at <= metric_clock.now)
            OR (
              status IN ('leased', 'running')
              AND lease_expires_at <= metric_clock.now
            )
          )
        THEN 1 ELSE 0
      END), 0) AS ready,
      COALESCE(SUM(CASE
        WHEN status = 'queued'
          AND attempt_count < max_attempts
          AND available_at > metric_clock.now
        THEN 1 ELSE 0
      END), 0) AS delayed,
      COALESCE(SUM(CASE
        WHEN status IN ('leased', 'running')
          AND lease_expires_at > metric_clock.now
        THEN 1 ELSE 0
      END), 0) AS active,
      COALESCE(SUM(CASE
        WHEN status IN ('leased', 'running')
          AND lease_expires_at <= metric_clock.now
        THEN 1 ELSE 0
      END), 0) AS expired_leases,
      COALESCE(SUM(CASE
        WHEN status = 'queued' AND attempt_count > 0
        THEN 1 ELSE 0
      END), 0) AS retry_queued,
      COALESCE(SUM(CASE
        WHEN attempt_count >= max_attempts
          AND (
            (status = 'queued' AND available_at <= metric_clock.now)
            OR (
              status IN ('leased', 'running')
              AND lease_expires_at <= metric_clock.now
            )
          )
        THEN 1 ELSE 0
      END), 0) AS exhausted,
      MIN(CASE
        WHEN attempt_count < max_attempts
          AND status = 'queued'
          AND available_at <= metric_clock.now
        THEN available_at
        WHEN attempt_count < max_attempts
          AND status IN ('leased', 'running')
          AND lease_expires_at <= metric_clock.now
        THEN lease_expires_at
        ELSE NULL
      END) AS oldest_ready_at,
      MIN(CASE
        WHEN status IN ('leased', 'running')
          AND lease_expires_at > metric_clock.now
        THEN COALESCE(started_at, created_at)
        ELSE NULL
      END) AS oldest_active_at
    FROM execution_jobs
    CROSS JOIN metric_clock
    WHERE status IN ('queued', 'leased', 'running')
  `);
  const finalizeExhaustedExecutionJobsStatement = db.query<ExecutionJobRow, [
    string,
    string,
    string,
    string | null,
    string | null,
    string,
    string,
    number
  ]>(`
    UPDATE execution_jobs
    SET status = 'failed',
        lease_owner = NULL,
        lease_expires_at = NULL,
        error_json = ?,
        updated_at = ?,
        completed_at = ?
    WHERE id IN (
      SELECT id
      FROM execution_jobs
      WHERE attempt_count >= max_attempts
        AND (? IS NULL OR kind = ?)
        AND (
          (status = 'queued' AND available_at <= ?)
          OR (status IN ('leased', 'running') AND lease_expires_at <= ?)
        )
      ORDER BY available_at ASC, created_at ASC, id ASC
      LIMIT ?
      )
    RETURNING *
  `);
  const claimExecutionJobStatement = db.query<ExecutionJobRow, [
    string,
    string,
    string,
    string,
    string | null,
    string | null,
    string,
    string
  ]>(`
    UPDATE execution_jobs
    SET status = 'leased',
        lease_owner = ?,
        lease_expires_at = ?,
        attempt_count = attempt_count + 1,
        started_at = ?,
        updated_at = ?,
        completed_at = NULL
    WHERE id = (
      SELECT id
      FROM execution_jobs
      WHERE (? IS NULL OR kind = ?)
        AND attempt_count < max_attempts
        AND (
          (status = 'queued' AND available_at <= ?)
          OR (status IN ('leased', 'running') AND lease_expires_at <= ?)
        )
      ORDER BY available_at ASC, created_at ASC, id ASC
      LIMIT 1
    )
    RETURNING *
  `);
  const markExecutionJobRunningStatement = db.query<ExecutionJobRow, [string, string, string, string, string]>(`
    UPDATE execution_jobs
    SET status = 'running', lease_expires_at = ?, updated_at = ?
    WHERE id = ?
      AND lease_owner = ?
      AND status IN ('leased', 'running')
      AND lease_expires_at > ?
    RETURNING *
  `);
  const renewExecutionJobLeaseStatement = db.query<ExecutionJobRow, [string, string, string, string, string]>(`
    UPDATE execution_jobs
    SET lease_expires_at = ?, updated_at = ?
    WHERE id = ?
      AND lease_owner = ?
      AND status IN ('leased', 'running')
      AND lease_expires_at > ?
    RETURNING *
  `);
  const completeExecutionJobStatement = db.query<ExecutionJobRow, [string, string, string, string, string]>(`
    UPDATE execution_jobs
    SET status = 'succeeded',
        lease_owner = NULL,
        lease_expires_at = NULL,
        error_json = NULL,
        updated_at = ?,
        completed_at = ?
    WHERE id = ?
      AND lease_owner = ?
      AND status IN ('leased', 'running')
      AND lease_expires_at > ?
    RETURNING *
  `);
  const updateFailedExecutionJobStatement = db.query<ExecutionJobRow, [
    string,
    string,
    string,
    string | null,
    string,
    string,
    string,
    string
  ]>(`
    UPDATE execution_jobs
    SET status = ?,
        lease_owner = NULL,
        lease_expires_at = NULL,
        started_at = NULL,
        available_at = ?,
        error_json = ?,
        completed_at = ?,
        updated_at = ?
    WHERE id = ?
      AND lease_owner = ?
      AND status IN ('leased', 'running')
      AND lease_expires_at > ?
    RETURNING *
  `);
  const cancelExecutionJobStatement = db.query<ExecutionJobRow, [string, string, string]>(`
    UPDATE execution_jobs
    SET status = 'cancelled',
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = ?,
        completed_at = ?
    WHERE id = ?
      AND status NOT IN ('succeeded', 'failed', 'cancelled')
    RETURNING *
  `);

  const parseJob = (row: JobRow) => {
    try {
      return latencyJobDetailSchema.parse(storageCrypto.parse(row.payload_json));
    } catch (error) {
      console.warn(
        JSON.stringify({
          service: 'webperf-api',
          warning: 'job_row_invalid',
          jobId: row.id,
          error: 'Persisted job payload could not be decoded',
          diagnostic: describePersistedPayloadError(error)
        })
      );
      return null;
    }
  };

  const parseEntity = <T>(kind: EntityKind, row: SavedEntityRow, schema: JsonSchema<T>) => {
    try {
      return schema.parse(storageCrypto.parse(row.payload_json));
    } catch (error) {
      console.warn(
        JSON.stringify({
          service: 'webperf-api',
          warning: 'saved_entity_invalid',
          kind,
          error: 'Persisted entity payload could not be decoded',
          diagnostic: describePersistedPayloadError(error)
        })
      );
      return null;
    }
  };

  const parseCheckProfileRun = (row: CheckProfileRunRow) => {
    try {
      return checkProfileRunSchema.parse(storageCrypto.parse(row.payload_json));
    } catch (error) {
      console.warn(
        JSON.stringify({
          service: 'webperf-api',
          warning: 'check_profile_run_invalid',
          error: 'Persisted check run payload could not be decoded',
          diagnostic: describePersistedPayloadError(error)
        })
      );
      return null;
    }
  };

  const parseExecutionJob = (row: ExecutionJobRow): ExecutionJob | null => {
    try {
      return executionJobSchema.parse({
        id: row.id,
        kind: row.kind,
        resourceId: row.resource_id,
        status: row.status,
        leaseOwner: row.lease_owner,
        leaseExpiresAt: row.lease_expires_at,
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
        availableAt: row.available_at,
        payload: storageCrypto.parse(row.payload_json),
        error: row.error_json
          ? executionJobErrorSchema.parse(storageCrypto.parse(row.error_json))
          : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at
      });
    } catch (error) {
      console.warn(
        JSON.stringify({
          service: 'webperf-api',
          warning: 'execution_job_invalid',
          executionJobId: row.id,
          error: 'Persisted execution job payload could not be decoded',
          diagnostic: describePersistedPayloadError(error)
        })
      );
      return null;
    }
  };

  const createEmptyStatusCounts = (): RuntimeExecutionStatusCounts =>
    Object.fromEntries(
      executionJobStatusValues.map((status) => [status, 0])
    ) as RuntimeExecutionStatusCounts;

  const createEmptyKindCounts = (): RuntimeExecutionQueueMetrics['byKind'] =>
    Object.fromEntries(
      executionJobKindValues.map((kind) => [
        kind,
        createEmptyStatusCounts()
      ])
    ) as RuntimeExecutionQueueMetrics['byKind'];

  const getExecutionMetricAgeMs = (
    timestamp: string | null,
    nowMs: number
  ) => {
    if (!timestamp) {
      return null;
    }
    const timestampMs = Date.parse(timestamp);
    if (!Number.isFinite(timestampMs)) {
      return null;
    }
    return Math.max(0, Math.trunc(nowMs - timestampMs));
  };

  const buildExecutionQueueMetrics = (
    now: Date,
    terminalCountsBoundedDays: number
  ): RuntimeExecutionQueueMetrics => {
    if (
      !Number.isSafeInteger(terminalCountsBoundedDays)
      || terminalCountsBoundedDays <= 0
    ) {
      throw new Error('Execution metric retention days must be a positive integer');
    }

    const byStatus = createEmptyStatusCounts();
    const byKind = createEmptyKindCounts();
    const terminalCutoff = new Date(now);
    terminalCutoff.setUTCDate(
      terminalCutoff.getUTCDate() - terminalCountsBoundedDays
    );

    for (const row of executionMetricCountsStatement.all(terminalCutoff.toISOString())) {
      const kind = executionJobKindValues.find((candidate) => candidate === row.kind);
      const status = executionJobStatusValues.find((candidate) => candidate === row.status);
      if (!kind || !status) {
        continue;
      }
      byStatus[status] += row.count;
      byKind[kind][status] += row.count;
    }

    const pressure = executionPressureStatement.get(now.toISOString());
    if (!pressure) {
      throw new Error('Execution pressure query did not return a snapshot');
    }

    return {
      ready: pressure.ready,
      delayed: pressure.delayed,
      active: pressure.active,
      expiredLeases: pressure.expired_leases,
      retryQueued: pressure.retry_queued,
      exhausted: pressure.exhausted,
      oldestReadyAgeMs: getExecutionMetricAgeMs(
        pressure.oldest_ready_at,
        now.getTime()
      ),
      oldestActiveAgeMs: getExecutionMetricAgeMs(
        pressure.oldest_active_at,
        now.getTime()
      ),
      byStatus,
      byKind
    };
  };

  const parseBrowserAuditArtifact = (
    row: BrowserAuditArtifactRow
  ): BrowserAuditArtifactRecord | null => {
    const artifact = normalizeBrowserAuditArtifactRecord({
      id: row.id,
      auditId: row.audit_id,
      registryVersion: row.registry_version,
      kind: row.kind,
      filename: row.filename,
      contentType: row.content_type,
      byteSize: row.byte_size,
      sha256: row.sha256,
      storageKey: row.storage_key,
      createdAt: row.created_at
    });

    if (!artifact) {
      console.warn(JSON.stringify({
        service: 'webperf-api',
        warning: 'browser_audit_artifact_row_invalid',
        artifactId: row.id
      }));
      return null;
    }

    return artifact;
  };

  const getEntity = <T>(kind: EntityKind, id: string, schema: JsonSchema<T>) => {
    const row = getEntityStatement.get(kind, id);
    return row ? parseEntity(kind, row, schema) : null;
  };

  const listEntities = <T>(kind: EntityKind, schema: JsonSchema<T>) =>
    listEntityStatement
      .all(kind)
      .map((row) => parseEntity(kind, row, schema))
      .filter((entity): entity is T => entity !== null);

  const saveEntity = (
    kind: EntityKind,
    entity: {
      id: string;
      createdAt: string;
      updatedAt: string;
    }
  ) => {
    saveEntityStatement.run(
      kind,
      entity.id,
      entity.createdAt,
      entity.updatedAt,
      storageCrypto.stringify(entity)
    );
  };

  const deleteEntity = (kind: EntityKind, id: string) => {
    const result = deleteEntityStatement.run(kind, id) as { changes?: number };
    return (result.changes ?? 0) > 0;
  };

  const persistRegionalExecutionTargetLinks = (
    record: RegionalExecutionRecord
  ) => {
    for (const target of record.targetLinks) {
      saveRegionalExecutionTargetStatement.run(
        record.id,
        target.executionJobId,
        target.jobId
      );
    }
  };

  const persistJob = (job: LatencyJobDetail) => {
    saveStatement.run(
      job.id,
      // This plaintext column is a query-free diagnostic index. The encrypted
      // payload remains the canonical record and is the only source used on read.
      redactUrlQuery(job.url),
      job.status,
      job.requestedAt,
      new Date().toISOString(),
      storageCrypto.stringify(job)
    );
  };

  const persistCheckProfileRun = (run: CheckProfileRun) => {
    saveCheckProfileRunStatement.run(
      run.id,
      run.profileId,
      run.createdAt,
      storageCrypto.stringify(run)
    );
  };

  const appendCheckProfileAlertDelivery = (
    runId: string,
    delivery: CheckProfileAlertDelivery
  ) => {
    const row = getCheckProfileRunStatement.get(runId);
    const run = row ? parseCheckProfileRun(row) : null;

    if (!run) {
      throw new Error('Webhook execution references a missing run');
    }

    if (run.alertDeliveries.some((item) => item.targetId === delivery.targetId)) {
      return;
    }

    persistCheckProfileRun({
      ...run,
      alertDeliveries: [...run.alertDeliveries, delivery]
    });
  };

  const persistBrowserAudit = (browserAudit: BrowserAuditResource) => {
    saveEntity('browser_audit', {
      ...browserAudit,
      createdAt: browserAudit.requestedAt,
      updatedAt: browserAudit.completedAt ?? browserAudit.startedAt ?? browserAudit.requestedAt
    });
  };

  const syncTerminalExecutionResource = (
    executionJob: ExecutionJob,
    nowIso: string
  ) => {
    if (executionJob.kind !== 'browser_audit') {
      return;
    }

    const audit = getEntity('browser_audit', executionJob.resourceId, browserAuditResourceSchema);

    if (!audit || ['succeeded', 'failed', 'cancelled'].includes(audit.status)) {
      return;
    }

    const cancelled = executionJob.status === 'cancelled';
    try {
      persistBrowserAudit({
        ...audit,
        status: cancelled ? 'cancelled' : 'failed',
        startedAt: cancelled ? audit.startedAt : audit.startedAt ?? nowIso,
        completedAt: nowIso,
        result: null,
        error: cancelled ? null : 'Browser Audit execution stopped before producing a result'
      });
    } catch {
      console.warn(JSON.stringify({
        service: 'webperf-api',
        warning: 'browser_audit_terminal_sync_failed',
        executionJobId: executionJob.id,
        resourceId: executionJob.resourceId
      }));
    }
  };

  const terminateRegionalExecutionRecord = (
    record: RegionalExecutionRecord,
    reason: 'cancelled' | 'deadline_exceeded',
    nowIso: string
  ) => {
    if (record.cancelledAt || record.deadlineExceededAt) {
      return record;
    }

    const executionJobIds = [...new Set(
      record.targetLinks.map((target) => target.executionJobId)
    )];
    const executionJobs = executionJobIds.map((executionJobId) => {
      const executionRow = getExecutionJobStatement.get(executionJobId);
      return executionRow ? parseExecutionJob(executionRow) : null;
    });
    const hasInflight = executionJobs.some(
      (executionJob) =>
        executionJob
        && !isTerminalExecutionJob(executionJob)
    );
    if (!hasInflight) {
      // Cancellation and deadline expiry must never rewrite an execution
      // that became terminal before the immediate transaction acquired
      // the writer reservation.
      return record;
    }

    for (const executionJob of executionJobs) {
      if (!executionJob || isTerminalExecutionJob(executionJob)) {
        continue;
      }
      const cancelledRow = cancelExecutionJobStatement.get(
        nowIso,
        nowIso,
        executionJob.id
      );
      const cancelled = cancelledRow ? parseExecutionJob(cancelledRow) : null;
      if (cancelled) {
        syncTerminalExecutionResource(cancelled, nowIso);
      }
    }

    const terminated = regionalExecutionRecordSchema.parse({
      ...record,
      cancelledAt: reason === 'cancelled' ? nowIso : null,
      deadlineExceededAt: reason === 'deadline_exceeded' ? nowIso : null,
      updatedAt: nowIso
    });
    saveEntity('regional_execution', terminated);
    return terminated;
  };

  const enqueueExecution = (input: EnqueueExecutionJob, now: Date) => {
    const parsed = enqueueExecutionJobSchema.parse(input);
    const nowIso = now.toISOString();
    const availableAtDate = parsed.availableAt ? new Date(parsed.availableAt) : now;
    if (availableAtDate.getTime() - now.getTime() > executionAvailabilityMaxDelayMs) {
      throw new Error(
        'Execution availability must not be more than '
        + `${executionAvailabilityMaxDelayDays} days in the future`
      );
    }
    const availableAt = availableAtDate.toISOString();
    const row = enqueueExecutionJobStatement.get(
      parsed.id,
      parsed.kind,
      parsed.resourceId,
      parsed.maxAttempts,
      availableAt,
      storageCrypto.stringify(parsed.payload),
      nowIso,
      nowIso
    );
    const persisted = row ?? getExecutionJobStatement.get(parsed.id);

    if (!persisted) {
      throw new Error('Execution job could not be persisted');
    }

    const executionJob = parseExecutionJob(persisted);

    if (!executionJob) {
      throw new Error('Persisted execution job could not be decoded');
    }

    if (executionJob.kind !== parsed.kind || executionJob.resourceId !== parsed.resourceId) {
      throw new Error('Execution job id already belongs to a different resource');
    }

    return executionJob;
  };

  const ownsRunningExecutionLease = (
    executionJobId: string,
    leaseOwner: string,
    nowIso: string
  ) => {
    const row = getExecutionJobStatement.get(executionJobId);
    const executionJob = row ? parseExecutionJob(row) : null;
    return Boolean(
      executionJob
      && executionJob.status === 'running'
      && executionJob.leaseOwner === leaseOwner
      && executionJob.leaseExpiresAt
      && executionJob.leaseExpiresAt > nowIso
    );
  };

  const persistExecutionResource = (result: ExecutionResourceResult) => {
    switch (result.kind) {
      case 'network_probe':
        for (const job of result.jobs) {
          persistJob(job);
        }

        if (result.run) {
          persistCheckProfileRun(result.run);
        }
        break;
      case 'browser_audit':
        persistBrowserAudit(result.audit);
        break;
      case 'webhook_delivery':
        appendCheckProfileAlertDelivery(result.runId, result.delivery);
        break;
      default:
        assertNever(result);
    }
  };

  let closed = false;

  return {
    getJob(id) {
      const row = getStatement.get(id);
      return row ? parseJob(row) : null;
    },
    listJobs() {
      return listStatement
        .all()
        .map(parseJob)
        .filter((job): job is LatencyJobDetail => job !== null)
        .map((job) => ({
          id: job.id,
          url: job.url,
          status: job.status,
          note: job.note,
          requestedAt: job.requestedAt,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          requesterIp: job.requesterIp,
          region: job.region,
          historicalRegions: job.historicalRegions
        }));
    },
    saveJob(job) {
      persistJob(job);
    },
    pruneJobsOlderThan(retentionDays, now = new Date()) {
      const cutoff = new Date(now);
      cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
      const result = pruneStatement.run(cutoff.toISOString()) as { changes?: number };
      return result.changes ?? 0;
    },
    pruneRetainedData(retentionDays, now = new Date()) {
      return cleanupSqliteRetention(db, retentionDays, now);
    },
    countJobs() {
      return countStatement.get()?.count ?? 0;
    },
    getProperty(id) {
      return getEntity('property', id, propertySchema);
    },
    listProperties() {
      return listEntities('property', propertySchema);
    },
    saveProperty(property) {
      saveEntity('property', property);
    },
    deleteProperty(id) {
      return deleteEntity('property', id);
    },
    getRouteSet(id) {
      return getEntity('route_set', id, routeSetSchema);
    },
    listRouteSets() {
      return listEntities('route_set', routeSetSchema);
    },
    saveRouteSet(routeSet) {
      saveEntity('route_set', routeSet);
    },
    deleteRouteSet(id) {
      return deleteEntity('route_set', id);
    },
    getCheckProfile(id) {
      return getEntity('check_profile', id, checkProfileSchema);
    },
    listCheckProfiles() {
      return listEntities('check_profile', checkProfileSchema);
    },
    saveCheckProfile(checkProfile) {
      saveEntity('check_profile', checkProfile);
    },
    deleteCheckProfile(id) {
      const deletedRuns = deleteCheckProfileRunsStatement.run(id) as { changes?: number };
      const deleted = deleteEntity('check_profile', id);

      return {
        deleted,
        deletedRunCount: deletedRuns.changes ?? 0
      };
    },
    getCheckProfileRun(id) {
      const row = getCheckProfileRunStatement.get(id);
      return row ? parseCheckProfileRun(row) : null;
    },
    listCheckProfileRuns(profileId) {
      return listCheckProfileRunsStatement
        .all(profileId)
        .map(parseCheckProfileRun)
        .filter((run): run is CheckProfileRun => run !== null);
    },
    saveCheckProfileRun(run) {
      persistCheckProfileRun(run);
    },
    getComparison(id) {
      return getEntity('comparison', id, comparisonResourceSchema);
    },
    listComparisons() {
      return listEntities('comparison', comparisonResourceSchema);
    },
    saveComparison(comparison) {
      saveEntity('comparison', {
        ...comparison,
        updatedAt: comparison.createdAt
      });
    },
    getExport(id) {
      return getEntity('export', id, exportResourceSchema);
    },
    listExports() {
      return listEntities('export', exportResourceSchema);
    },
    saveExport(exportResource) {
      saveEntity('export', {
        ...exportResource,
        updatedAt: exportResource.createdAt
      });
    },
    getAnalysis(id) {
      return getEntity('analysis', id, analysisResourceSchema);
    },
    listAnalyses() {
      return listEntities('analysis', analysisResourceSchema);
    },
    saveAnalysis(analysis) {
      saveEntity('analysis', {
        ...analysis,
        updatedAt: analysis.createdAt
      });
    },
    getBrowserAudit(id) {
      return getEntity('browser_audit', id, browserAuditResourceSchema);
    },
    listBrowserAudits() {
      return listEntities('browser_audit', browserAuditResourceSchema);
    },
    saveBrowserAudit(browserAudit) {
      persistBrowserAudit(browserAudit);
    },
    saveBrowserAuditArtifact(artifact) {
      // Writes and reads share this public-contract normalizer so malformed
      // internal metadata can never become a persistently unreadable row.
      const validatedArtifact = normalizeBrowserAuditArtifactRecord(artifact);
      if (!validatedArtifact) {
        throw new TypeError('Browser Audit artifact metadata is invalid');
      }

      const save = db.transaction(() => {
        const existing = getBrowserAuditArtifactStatement.get(
          validatedArtifact.auditId,
          validatedArtifact.id
        );
        if (existing) {
          return false;
        }

        const count = countBrowserAuditArtifactsStatement.get(validatedArtifact.auditId)?.count ?? 0;
        if (count >= maximumBrowserAuditArtifactsPerAudit) {
          return false;
        }

        const result = saveBrowserAuditArtifactStatement.run(
          validatedArtifact.id,
          validatedArtifact.auditId,
          validatedArtifact.registryVersion,
          validatedArtifact.kind,
          validatedArtifact.filename,
          validatedArtifact.contentType,
          validatedArtifact.byteSize,
          validatedArtifact.sha256,
          validatedArtifact.storageKey,
          validatedArtifact.createdAt
        ) as { changes?: number };
        return (result.changes ?? 0) === 1;
      });

      try {
        return save();
      } catch (error) {
        // The trigger remains a cross-process backstop if another API connection
        // wins the race after this transaction's explicit count check.
        if (isBrowserAuditArtifactLimitConstraint(error)) {
          return false;
        }

        throw error;
      }
    },
    getBrowserAuditArtifact(auditId, artifactId) {
      const row = getBrowserAuditArtifactStatement.get(auditId, artifactId);
      return row ? parseBrowserAuditArtifact(row) : null;
    },
    listBrowserAuditArtifacts(auditId) {
      return listBrowserAuditArtifactsStatement
        .all(auditId)
        .map(parseBrowserAuditArtifact)
        .filter((artifact): artifact is BrowserAuditArtifactRecord => artifact !== null);
    },
    listBrowserAuditArtifactStorageKeys() {
      return listBrowserAuditArtifactStorageKeysStatement
        .all()
        .map((row) => row.storage_key);
    },
    getRegionalExecution(id) {
      return getEntity('regional_execution', id, regionalExecutionRecordSchema);
    },
    createRegionalExecution(input, now = new Date()) {
      const record = regionalExecutionRecordSchema.parse(input.record);
      const create = db.transaction(() => {
        const existingRow = getEntityStatement.get('regional_execution', record.id);

        if (existingRow) {
          const existing = parseEntity(
            'regional_execution',
            existingRow,
            regionalExecutionRecordSchema
          );
          if (!existing) {
            throw new Error(`Regional execution ${record.id} could not be decoded`);
          }
          persistRegionalExecutionTargetLinks(existing);
          return {
            record: existing,
            created: false
          };
        }

        for (const resource of input.resources) {
          if (resource.executionJob.kind !== resource.result.kind) {
            throw new Error(
              `Regional execution resource kind ${resource.result.kind} does not match `
              + `queue job kind ${resource.executionJob.kind}`
            );
          }
          persistExecutionResource(resource.result);
          enqueueExecution(resource.executionJob, now);
        }

        saveEntity('regional_execution', record);
        persistRegionalExecutionTargetLinks(record);
        return {
          record,
          created: true
        };
      });

      return create();
    },
    saveRegionalExecution(record) {
      saveEntity('regional_execution', regionalExecutionRecordSchema.parse(record));
    },
    terminateRegionalExecution(input, now = new Date()) {
      const terminate = db.transaction(() => {
        const row = getEntityStatement.get('regional_execution', input.id);
        if (!row) {
          return null;
        }
        const record = parseEntity(
          'regional_execution',
          row,
          regionalExecutionRecordSchema
        );
        if (!record) {
          throw new Error(`Regional execution ${input.id} could not be decoded`);
        }
        const nowIso = now.toISOString();
        return terminateRegionalExecutionRecord(record, input.reason, nowIso);
      });

      // Acquire the writer reservation before terminal-state reads so executor
      // completion cannot interleave between detection and cancellation.
      return terminate.immediate();
    },
    createExecutionResource(input, now = new Date()) {
      if (input.executionJob.kind !== input.result.kind) {
        throw new Error('Execution resource kind does not match its queue job');
      }

      const create = db.transaction(() => {
        persistExecutionResource(input.result);
        return enqueueExecution(input.executionJob, now);
      });
      return create();
    },
    saveExecutionResourceResult(input, now = new Date()) {
      // Persistence intentionally precedes completion because network executions may
      // still enqueue follow-ups. Every resource write is idempotent/upserted, so a
      // crash in that window is handled by the queue's at-least-once retry contract.
      const save = db.transaction(() => {
        if (!ownsRunningExecutionLease(input.executionJobId, input.leaseOwner, now.toISOString())) {
          return false;
        }

        persistExecutionResource(input.result);

        return true;
      });
      return save();
    },
    enqueueExecutionJob(input, now = new Date()) {
      return enqueueExecution(input, now);
    },
    enqueueExecutionJobs(input, now = new Date()) {
      const enqueue = db.transaction(() => {
        if (!ownsRunningExecutionLease(input.executionJobId, input.leaseOwner, now.toISOString())) {
          return null;
        }

        return input.jobs.map((job) => enqueueExecution(job, now));
      });
      return enqueue();
    },
    getExecutionJob(id) {
      const row = getExecutionJobStatement.get(id);
      return row ? parseExecutionJob(row) : null;
    },
    listExecutionJobs() {
      return listExecutionJobsStatement
        .all()
        .map(parseExecutionJob)
        .filter((job): job is ExecutionJob => job !== null);
    },
    getExecutionQueueMetrics(now, terminalCountsBoundedDays) {
      return buildExecutionQueueMetrics(now, terminalCountsBoundedDays);
    },
    claimExecutionJob(input, now = new Date()) {
      const leaseExpiresAt = getLeaseExpiresAt(input, now);
      const nowIso = now.toISOString();
      const executionKind = input.kind ?? null;
      const exhaustedError = storageCrypto.stringify({
        code: 'lease_attempts_exhausted',
        message: 'Execution stopped after the maximum number of lease attempts',
        retryable: false
      } satisfies ExecutionJobError);

      const claim = db.transaction(() => {
        const exhaustedRows = finalizeExhaustedExecutionJobsStatement.all(
          exhaustedError,
          nowIso,
          nowIso,
          executionKind,
          executionKind,
          nowIso,
          nowIso,
          executionExhaustionFinalizationBatchSize
        );
        for (const row of exhaustedRows) {
          const executionJob = parseExecutionJob(row);

          if (executionJob) {
            syncTerminalExecutionResource(executionJob, nowIso);
          }
        }

        return claimExecutionJobStatement.get(
          input.leaseOwner,
          leaseExpiresAt,
          nowIso,
          nowIso,
          executionKind,
          executionKind,
          nowIso,
          nowIso
        );
      });
      const row = claim();
      return row ? parseExecutionJob(row) : null;
    },
    markExecutionJobRunning(input, now = new Date()) {
      const leaseExpiresAt = getLeaseExpiresAt(input, now);
      const nowIso = now.toISOString();
      const row = markExecutionJobRunningStatement.get(
        leaseExpiresAt,
        nowIso,
        input.id,
        input.leaseOwner,
        nowIso
      );
      return row ? parseExecutionJob(row) : null;
    },
    renewExecutionJobLease(input, now = new Date()) {
      const leaseExpiresAt = getLeaseExpiresAt(input, now);
      const nowIso = now.toISOString();
      const row = renewExecutionJobLeaseStatement.get(
        leaseExpiresAt,
        nowIso,
        input.id,
        input.leaseOwner,
        nowIso
      );
      return row ? parseExecutionJob(row) : null;
    },
    completeExecutionJob(input, now = new Date()) {
      assertLeaseOwner(input.leaseOwner);
      const complete = db.transaction(() => {
        const persisted = getExecutionJobStatement.get(input.id);
        const executionJob = persisted ? parseExecutionJob(persisted) : null;

        if (!executionJob) {
          return null;
        }

        if (executionJob.status === 'succeeded') {
          return executionJob;
        }

        const nowIso = now.toISOString();
        const ownsCompletableLease = (
          (executionJob.status === 'leased' || executionJob.status === 'running')
          && executionJob.leaseOwner === input.leaseOwner
          && executionJob.leaseExpiresAt !== null
          && executionJob.leaseExpiresAt > nowIso
        );
        if (!ownsCompletableLease) {
          return null;
        }

        const regionalPayload = executionJob.kind === 'network_probe'
          ? networkProbeExecutionPayloadSchema.safeParse(executionJob.payload)
          : null;
        if (
          regionalPayload?.success
          && regionalPayload.data.regionalExecutionId
          && regionalPayload.data.deadlineAt
          && Date.parse(regionalPayload.data.deadlineAt) <= now.getTime()
        ) {
          const regionalRow = getEntityStatement.get(
            'regional_execution',
            regionalPayload.data.regionalExecutionId
          );
          const regionalRecord = regionalRow
            ? parseEntity(
                'regional_execution',
                regionalRow,
                regionalExecutionRecordSchema
              )
            : null;
          if (!regionalRecord) {
            throw new Error('Regional execution deadline references a missing record');
          }
          terminateRegionalExecutionRecord(
            regionalRecord,
            'deadline_exceeded',
            nowIso
          );
          return null;
        }

        const row = completeExecutionJobStatement.get(
          nowIso,
          nowIso,
          input.id,
          input.leaseOwner,
          nowIso
        );
        return row ? parseExecutionJob(row) : null;
      });

      // The accepted regional deadline and terminal queue transition share one
      // writer reservation, so a late completion cannot win a polling race.
      return complete.immediate();
    },
    failExecutionJob(input, now = new Date()) {
      assertLeaseOwner(input.leaseOwner);
      const error = executionJobErrorSchema.parse(input.error);
      const retryDelayMs = input.retryDelayMs ?? defaultExecutionRetryDelayMs;

      if (
        !Number.isSafeInteger(retryDelayMs)
        || retryDelayMs < 0
        || retryDelayMs > executionRetryDelayMaxMs
      ) {
        throw new Error(
          `Execution retry delay must be an integer between 0 and ${executionRetryDelayMaxMs}ms`
        );
      }

      const fail = db.transaction(() => {
        const persisted = getExecutionJobStatement.get(input.id);

        if (!persisted) {
          return null;
        }

        const executionJob = parseExecutionJob(persisted);

        if (!executionJob) {
          return null;
        }

        if (isTerminalExecutionJob(executionJob)) {
          if (executionJob.status === 'failed') {
            syncTerminalExecutionResource(
              executionJob,
              executionJob.completedAt ?? now.toISOString()
            );
          }
          return executionJob;
        }

        const nowIso = now.toISOString();

        if (
          executionJob.leaseOwner !== input.leaseOwner
          || !executionJob.leaseExpiresAt
          || executionJob.leaseExpiresAt <= nowIso
        ) {
          return null;
        }

        const terminal = !error.retryable || executionJob.attemptCount >= executionJob.maxAttempts;
        const availableAt = terminal
          ? executionJob.availableAt
          : new Date(now.getTime() + retryDelayMs).toISOString();
        const row = updateFailedExecutionJobStatement.get(
          terminal ? 'failed' : 'queued',
          availableAt,
          storageCrypto.stringify(error),
          terminal ? nowIso : null,
          nowIso,
          input.id,
          input.leaseOwner,
          nowIso
        );
        const failedExecutionJob = row ? parseExecutionJob(row) : null;

        if (failedExecutionJob?.status === 'failed') {
          syncTerminalExecutionResource(failedExecutionJob, nowIso);
        }

        return failedExecutionJob;
      });

      return fail();
    },
    cancelExecutionJob(id, now = new Date()) {
      const cancel = db.transaction(() => {
        const nowIso = now.toISOString();
        const row = cancelExecutionJobStatement.get(nowIso, nowIso, id);

        if (row) {
          const executionJob = parseExecutionJob(row);

          if (executionJob) {
            syncTerminalExecutionResource(executionJob, nowIso);
          }

          return executionJob;
        }

        const existing = getExecutionJobStatement.get(id);
        const executionJob = existing ? parseExecutionJob(existing) : null;

        if (executionJob?.status === 'cancelled') {
          // A previous cancellation can commit the queue transition before a
          // resource-sync failure. Repeating the idempotent sync repairs that split.
          syncTerminalExecutionResource(
            executionJob,
            executionJob.completedAt ?? nowIso
          );
          return executionJob;
        }

        return null;
      });

      return cancel();
    },
    close() {
      if (closed) {
        return;
      }

      closed = true;
      db.close();
    }
  };
};

const assertNever = (value: never): never => {
  void value;
  throw new Error('Unsupported execution resource result kind');
};

const isTerminalExecutionJob = (executionJob: ExecutionJob) =>
  ['succeeded', 'failed', 'cancelled'].includes(executionJob.status);

const assertLeaseOwner = (leaseOwner: string) => {
  if (leaseOwner.length < 1 || leaseOwner.length > executionLeaseOwnerMaxLength) {
    throw new Error(
      `Execution lease owner must contain between 1 and ${executionLeaseOwnerMaxLength} characters`
    );
  }
};

const getLeaseExpiresAt = (input: ExecutionJobLeaseInput, now: Date) => {
  assertLeaseOwner(input.leaseOwner);

  if (
    !Number.isSafeInteger(input.leaseDurationMs)
    || input.leaseDurationMs < executionLeaseDurationMinMs
    || input.leaseDurationMs > executionLeaseDurationMaxMs
  ) {
    throw new Error(
      'Execution lease duration must be an integer between '
      + `${executionLeaseDurationMinMs} and ${executionLeaseDurationMaxMs}ms`
    );
  }

  return new Date(now.getTime() + input.leaseDurationMs).toISOString();
};

const describePersistedPayloadError = (error: unknown) => {
  if (error instanceof AggregateError) {
    return { type: 'decryption_failed', attempts: error.errors.length };
  }

  if (error instanceof SyntaxError) {
    return { type: 'invalid_json' };
  }

  if (error instanceof UnencryptedPersistedPayloadError) {
    return { type: 'unencrypted_payload' };
  }

  if (error instanceof InvalidEncryptedPayloadEnvelopeError) {
    return { type: 'invalid_envelope' };
  }

  const issues = (error as { issues?: unknown } | null)?.issues;

  if (Array.isArray(issues)) {
    return {
      type: 'schema_validation',
      issues: issues.slice(0, 20).map((issue) => {
        const candidate = issue as { code?: unknown; path?: unknown };
        return {
          code: typeof candidate.code === 'string' ? candidate.code : 'unknown',
          path: Array.isArray(candidate.path)
            ? candidate.path.filter((part): part is string | number =>
                typeof part === 'string' || typeof part === 'number'
              )
            : []
        };
      })
    };
  }

  return { type: 'payload_decode_failed' };
};
