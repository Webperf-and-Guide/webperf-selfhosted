import { Database } from 'bun:sqlite';
import type {
  AnalysisResource,
  CheckProfile,
  CheckProfileRun,
  ComparisonResource,
  ExportResource,
  LatencyJob,
  LatencyJobDetail,
  Property,
  RegionPack,
  RouteSet
} from '@webperf/contracts';
import {
  analysisResourceSchema,
  checkProfileSchema,
  checkProfileRunSchema,
  comparisonResourceSchema,
  exportResourceSchema,
  latencyJobDetailSchema,
  propertySchema,
  regionPackSchema,
  routeSetSchema
} from '@webperf/contracts';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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
  close(): void;
};

type EntityKind =
  | 'property'
  | 'route_set'
  | 'region_pack'
  | 'check_profile'
  | 'comparison'
  | 'export'
  | 'analysis';

type SavedEntityRow = {
  payload_json: string;
};

type CheckProfileRunRow = {
  payload_json: string;
};

type JsonSchema<T> = {
  parse(value: unknown): T;
};

export const createSqliteJobRepository = ({
  databasePath
}: {
  databasePath: string;
}): JobRepository => {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const db = new Database(databasePath, {
    create: true,
    strict: true
  });

  db.exec(`
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

  const parseJob = (row: JobRow) => {
    try {
      return latencyJobDetailSchema.parse(JSON.parse(row.payload_json));
    } catch (error) {
      console.warn(
        JSON.stringify({
          service: 'webperf-api',
          warning: 'job_row_invalid',
          jobId: row.id,
          error: error instanceof Error ? error.message : 'Invalid job payload'
        })
      );
      return null;
    }
  };

  const parseEntity = <T>(kind: EntityKind, row: SavedEntityRow, schema: JsonSchema<T>) => {
    try {
      return schema.parse(JSON.parse(row.payload_json));
    } catch (error) {
      console.warn(
        JSON.stringify({
          service: 'webperf-api',
          warning: 'saved_entity_invalid',
          kind,
          error: error instanceof Error ? error.message : 'Invalid saved entity payload'
        })
      );
      return null;
    }
  };

  const parseCheckProfileRun = (row: CheckProfileRunRow) => {
    try {
      return checkProfileRunSchema.parse(JSON.parse(row.payload_json));
    } catch (error) {
      console.warn(
        JSON.stringify({
          service: 'webperf-api',
          warning: 'check_profile_run_invalid',
          error: error instanceof Error ? error.message : 'Invalid check profile run payload'
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
      JSON.stringify(entity)
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
        job.url,
        job.status,
        job.requestedAt,
        new Date().toISOString(),
        JSON.stringify(job)
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
        JSON.stringify(run)
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
    close() {
      db.close();
    }
  };
};
