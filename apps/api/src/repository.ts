import { Database } from 'bun:sqlite';
import type {
  AnalysisResource,
  BrowserAuditResource,
  CheckProfile,
  CheckProfileRun,
  ComparisonResource,
  EnqueueExecutionJob,
  ExecutionJob,
  ExecutionJobError,
  ExportResource,
  LatencyJob,
  LatencyJobDetail,
  Property,
  RegionPack,
  RouteSet
} from '@webperf/contracts';
import {
  analysisResourceSchema,
  browserAuditResourceSchema,
  checkProfileSchema,
  checkProfileRunSchema,
  comparisonResourceSchema,
  enqueueExecutionJobSchema,
  executionJobErrorSchema,
  executionJobSchema,
  exportResourceSchema,
  latencyJobDetailSchema,
  propertySchema,
  regionPackSchema,
  routeSetSchema
} from '@webperf/contracts';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createStorageCrypto } from './storage-crypto';
import { redactUrlQuery } from './redaction';

type JobRow = {
  id: string;
  payload_json: string;
};

export type JobRepository = {
  getJob(id: string): LatencyJobDetail | null;
  listJobs(): LatencyJob[];
  saveJob(job: LatencyJobDetail): void;
  pruneJobsOlderThan(retentionDays: number, now?: Date): number;
  countJobs(): number;
  getProperty(id: string): Property | null;
  listProperties(): Property[];
  saveProperty(property: Property): void;
  deleteProperty(id: string): boolean;
  getRouteSet(id: string): RouteSet | null;
  listRouteSets(): RouteSet[];
  saveRouteSet(routeSet: RouteSet): void;
  deleteRouteSet(id: string): boolean;
  getRegionPack(id: string): RegionPack | null;
  listRegionPacks(): RegionPack[];
  saveRegionPack(regionPack: RegionPack): void;
  deleteRegionPack(id: string): boolean;
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
  enqueueExecutionJob(input: EnqueueExecutionJob, now?: Date): ExecutionJob;
  getExecutionJob(id: string): ExecutionJob | null;
  listExecutionJobs(): ExecutionJob[];
  claimExecutionJob(input: ExecutionJobLeaseInput, now?: Date): ExecutionJob | null;
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

export type ExecutionJobOwnerInput = {
  id: string;
  leaseOwner: string;
};

type EntityKind =
  | 'property'
  | 'route_set'
  | 'region_pack'
  | 'check_profile'
  | 'comparison'
  | 'export'
  | 'analysis'
  | 'browser_audit';

type SavedEntityRow = {
  payload_json: string;
};

type CheckProfileRunRow = {
  payload_json: string;
};

type PersistedPayloadRow = {
  rowid: number;
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
  updated_at: string;
  completed_at: string | null;
};

const encryptedPayloadMigrationId = '20260722_001_encrypted_payloads_v2';
const executionJobsMigrationId = '20260722_002_execution_jobs';

type JsonSchema<T> = {
  parse(value: unknown): T;
};

export const createSqliteJobRepository = ({
  databasePath,
  encryptionSecret,
  encryptionSecretNext
}: {
  databasePath: string;
  encryptionSecret: string;
  encryptionSecretNext?: string;
}): JobRepository => {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const db = new Database(databasePath, {
    create: true,
    strict: true
  });
  const storageCrypto = createStorageCrypto({
    currentSecret: encryptionSecret,
    nextSecret: encryptionSecretNext
  });

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS jobs_requested_at_idx
      ON jobs (requested_at DESC);

    CREATE TABLE IF NOT EXISTS saved_entities (
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (kind, id)
    );

    CREATE INDEX IF NOT EXISTS saved_entities_kind_updated_at_idx
      ON saved_entities (kind, updated_at DESC);

    CREATE TABLE IF NOT EXISTS check_profile_runs (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS check_profile_runs_profile_created_at_idx
      ON check_profile_runs (profile_id, created_at DESC);
  `);

  const encryptedPayloadMigration = db
    .query<{ id: string }, [string]>('SELECT id FROM schema_migrations WHERE id = ? LIMIT 1')
    .get(encryptedPayloadMigrationId);

  if (!encryptedPayloadMigration) {
    const migratePayloads = db.transaction(() => {
      for (const table of ['jobs', 'saved_entities', 'check_profile_runs'] as const) {
        const rows = db
          .query<PersistedPayloadRow, []>(`SELECT rowid, payload_json FROM ${table}`)
          .all();
        const update = db.query(`UPDATE ${table} SET payload_json = ? WHERE rowid = ?`);

        for (const row of rows) {
          const parsed = storageCrypto.parse(row.payload_json, { allowPlaintext: true });
          update.run(storageCrypto.stringify(parsed), row.rowid);
        }
      }

      db.query('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
        encryptedPayloadMigrationId,
        new Date().toISOString()
      );
    });

    migratePayloads();
  }

  const executionJobsMigration = db
    .query<{ id: string }, [string]>('SELECT id FROM schema_migrations WHERE id = ? LIMIT 1')
    .get(executionJobsMigrationId);

  if (!executionJobsMigration) {
    const migrateExecutionJobs = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS execution_jobs (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('network_probe', 'browser_audit', 'webhook_delivery')),
          resource_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('queued', 'leased', 'running', 'succeeded', 'failed', 'cancelled')),
          lease_owner TEXT,
          lease_expires_at TEXT,
          attempt_count INTEGER NOT NULL,
          max_attempts INTEGER NOT NULL CHECK (max_attempts > 0 AND max_attempts <= 20),
          available_at TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          error_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT,
          CHECK (attempt_count >= 0 AND attempt_count <= max_attempts),
          CHECK (
            (
              status IN ('leased', 'running')
              AND lease_owner IS NOT NULL
              AND lease_expires_at IS NOT NULL
              AND completed_at IS NULL
            )
            OR (
              status = 'queued'
              AND lease_owner IS NULL
              AND lease_expires_at IS NULL
              AND completed_at IS NULL
            )
            OR (
              status IN ('succeeded', 'failed', 'cancelled')
              AND lease_owner IS NULL
              AND lease_expires_at IS NULL
              AND completed_at IS NOT NULL
            )
          )
        );

        CREATE INDEX IF NOT EXISTS execution_jobs_claim_idx
          ON execution_jobs (status, available_at, lease_expires_at, created_at);

        CREATE INDEX IF NOT EXISTS execution_jobs_resource_idx
          ON execution_jobs (kind, resource_id, created_at DESC);
      `);

      db.query('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
        executionJobsMigrationId,
        new Date().toISOString()
      );
    });

    migrateExecutionJobs();
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
  const finalizeExhaustedExecutionJobsStatement = db.query(`
    UPDATE execution_jobs
    SET status = 'failed',
        lease_owner = NULL,
        lease_expires_at = NULL,
        error_json = ?,
        updated_at = ?,
        completed_at = ?
    WHERE attempt_count >= max_attempts
      AND (
        (status = 'queued' AND available_at <= ?)
        OR (status IN ('leased', 'running') AND lease_expires_at <= ?)
      )
  `);
  const claimExecutionJobStatement = db.query<ExecutionJobRow, [string, string, string, string, string]>(`
    UPDATE execution_jobs
    SET status = 'leased',
        lease_owner = ?,
        lease_expires_at = ?,
        attempt_count = attempt_count + 1,
        updated_at = ?,
        completed_at = NULL
    WHERE id = (
      SELECT id
      FROM execution_jobs
      WHERE attempt_count < max_attempts
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
    } catch {
      console.warn(
        JSON.stringify({
          service: 'webperf-api',
          warning: 'job_row_invalid',
          jobId: row.id,
          error: 'Persisted job payload could not be decoded'
        })
      );
      return null;
    }
  };

  const parseEntity = <T>(kind: EntityKind, row: SavedEntityRow, schema: JsonSchema<T>) => {
    try {
      return schema.parse(storageCrypto.parse(row.payload_json));
    } catch {
      console.warn(
        JSON.stringify({
          service: 'webperf-api',
          warning: 'saved_entity_invalid',
          kind,
          error: 'Persisted entity payload could not be decoded'
        })
      );
      return null;
    }
  };

  const parseCheckProfileRun = (row: CheckProfileRunRow) => {
    try {
      return checkProfileRunSchema.parse(storageCrypto.parse(row.payload_json));
    } catch {
      console.warn(
        JSON.stringify({
          service: 'webperf-api',
          warning: 'check_profile_run_invalid',
          error: 'Persisted check run payload could not be decoded'
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
          selectedRegions: job.selectedRegions
        }));
    },
    saveJob(job) {
      saveStatement.run(
        job.id,
        redactUrlQuery(job.url),
        job.status,
        job.requestedAt,
        new Date().toISOString(),
        storageCrypto.stringify(job)
      );
    },
    pruneJobsOlderThan(retentionDays, now = new Date()) {
      const cutoff = new Date(now);
      cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
      const result = pruneStatement.run(cutoff.toISOString()) as { changes?: number };
      return result.changes ?? 0;
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
    getRegionPack(id) {
      return getEntity('region_pack', id, regionPackSchema);
    },
    listRegionPacks() {
      return listEntities('region_pack', regionPackSchema);
    },
    saveRegionPack(regionPack) {
      saveEntity('region_pack', regionPack);
    },
    deleteRegionPack(id) {
      return deleteEntity('region_pack', id);
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
      saveCheckProfileRunStatement.run(
        run.id,
        run.profileId,
        run.createdAt,
        storageCrypto.stringify(run)
      );
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
      saveEntity('browser_audit', {
        ...browserAudit,
        createdAt: browserAudit.requestedAt,
        updatedAt: browserAudit.completedAt ?? browserAudit.startedAt ?? browserAudit.requestedAt
      });
    },
    enqueueExecutionJob(input, now = new Date()) {
      const parsed = enqueueExecutionJobSchema.parse(input);
      const nowIso = now.toISOString();
      const availableAt = parsed.availableAt
        ? new Date(parsed.availableAt).toISOString()
        : nowIso;
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
    claimExecutionJob(input, now = new Date()) {
      const leaseExpiresAt = getLeaseExpiresAt(input, now);
      const nowIso = now.toISOString();
      const exhaustedError = storageCrypto.stringify({
        code: 'lease_attempts_exhausted',
        message: 'Execution stopped after the maximum number of lease attempts',
        retryable: false
      } satisfies ExecutionJobError);

      const claim = db.transaction(() => {
        finalizeExhaustedExecutionJobsStatement.run(
          exhaustedError,
          nowIso,
          nowIso,
          nowIso,
          nowIso
        );

        return claimExecutionJobStatement.get(
          input.leaseOwner,
          leaseExpiresAt,
          nowIso,
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
      const nowIso = now.toISOString();
      const row = completeExecutionJobStatement.get(
        nowIso,
        nowIso,
        input.id,
        input.leaseOwner,
        nowIso
      );

      if (row) {
        return parseExecutionJob(row);
      }

      const existing = getExecutionJobStatement.get(input.id);
      const executionJob = existing ? parseExecutionJob(existing) : null;
      return executionJob?.status === 'succeeded' ? executionJob : null;
    },
    failExecutionJob(input, now = new Date()) {
      assertLeaseOwner(input.leaseOwner);
      const error = executionJobErrorSchema.parse(input.error);
      const retryDelayMs = input.retryDelayMs ?? 1_000;

      if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 86_400_000) {
        throw new Error('Execution retry delay must be an integer between 0 and 86400000ms');
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

        if (['succeeded', 'failed', 'cancelled'].includes(executionJob.status)) {
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
        return row ? parseExecutionJob(row) : null;
      });

      return fail();
    },
    cancelExecutionJob(id, now = new Date()) {
      const nowIso = now.toISOString();
      const row = cancelExecutionJobStatement.get(nowIso, nowIso, id);

      if (row) {
        return parseExecutionJob(row);
      }

      const existing = getExecutionJobStatement.get(id);
      const executionJob = existing ? parseExecutionJob(existing) : null;
      return executionJob?.status === 'cancelled' ? executionJob : null;
    },
    close() {
      db.close();
    }
  };
};

const assertLeaseOwner = (leaseOwner: string) => {
  if (leaseOwner.length < 1 || leaseOwner.length > 160) {
    throw new Error('Execution lease owner must contain between 1 and 160 characters');
  }
};

const getLeaseExpiresAt = (input: ExecutionJobLeaseInput, now: Date) => {
  assertLeaseOwner(input.leaseOwner);

  if (
    !Number.isSafeInteger(input.leaseDurationMs)
    || input.leaseDurationMs < 1_000
    || input.leaseDurationMs > 3_600_000
  ) {
    throw new Error('Execution lease duration must be an integer between 1000 and 3600000ms');
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

  if (error instanceof Error) {
    if (error.message === 'Refusing to parse an unencrypted persisted payload') {
      return { type: 'unencrypted_payload' };
    }
    if (error.message === 'Invalid encrypted payload envelope') {
      return { type: 'invalid_envelope' };
    }
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
