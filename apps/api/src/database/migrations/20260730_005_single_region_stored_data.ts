import type { SqliteMigration } from './types';
import {
  latencyJobDetailSchema,
  type CheckProfileLocationMigrationReason
} from '@webperf/contracts';
import { deriveJobStatus, summarizeTargets } from '@webperf/report-core';

const historicalMultiRegionId = 'historical-multi-region';
const migrationBatchSize = 100;

type PersistedPayloadRow = {
  rowid: number;
  payload_json: string;
};

type JsonRecord = Record<string, unknown>;

type FirstBatchStatement = {
  all: () => PersistedPayloadRow[];
  finalize: () => void;
};

type NextBatchStatement = {
  all: (lastRowId: number) => PersistedPayloadRow[];
  finalize: () => void;
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toStringArray = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : null;

const resolveMigrationReason = (
  sourceRegions: string[],
  safeSingleton: boolean
): CheckProfileLocationMigrationReason => {
  if (sourceRegions.length === 0) {
    return 'legacy_region_pack_missing' as const;
  }
  if (sourceRegions.length > 1) {
    return 'legacy_multi_region' as const;
  }
  return safeSingleton
    ? 'singleton_matches_runtime' as const
    : 'legacy_region_mismatch' as const;
};

const rewriteLegacyJob = (value: unknown) => {
  if (!isRecord(value) || 'region' in value) {
    return value;
  }

  const selectedRegions = toStringArray(value.selectedRegions);
  if (!selectedRegions || selectedRegions.length === 0) {
    return value;
  }

  const { selectedRegions: _removed, ...rest } = value;
  return {
    ...rest,
    region: selectedRegions.length === 1
      ? selectedRegions[0]
      : historicalMultiRegionId,
    historicalRegions: selectedRegions
  };
};

const finishLegacyMultiRegionJob = (
  value: unknown,
  migrationTimestamp: string
) => {
  const rewritten = rewriteLegacyJob(value);
  const selectedRegions = isRecord(value)
    ? toStringArray(value.selectedRegions)
    : null;
  if (
    !isRecord(value)
    || !isRecord(rewritten)
    || !selectedRegions
    || selectedRegions.length <= 1
    || !Array.isArray(rewritten.targets)
  ) {
    return {
      value: rewritten,
      cancelledExecutionResourceId: null,
      terminalStatus: null
    };
  }

  const parsed = latencyJobDetailSchema.safeParse(rewritten);
  if (!parsed.success) {
    return {
      value: rewritten,
      cancelledExecutionResourceId:
        typeof rewritten.id === 'string' ? rewritten.id : null,
      terminalStatus: null
    };
  }

  let changed = false;
  const targets = parsed.data.targets.map((target) => {
    if (
      target.status === 'succeeded'
      || target.status === 'failed'
    ) {
      return target;
    }
    changed = true;
    return {
      ...target,
      status: 'failed' as const,
      latencyMs: null,
      statusCode: null,
      success: false,
      probeImpl: null,
      measurement: null,
      slotId: null,
      errorCode: 'single_region_upgrade_cancelled',
      errorClass: 'terminal' as const,
      errorMessage:
        'Unfinished multi-region execution was cancelled during the single-region upgrade',
      finishedAt: migrationTimestamp,
      updatedAt: migrationTimestamp
    };
  });
  const terminalStatus = deriveJobStatus(targets);

  return {
    value: changed
      ? {
          ...parsed.data,
          status: terminalStatus,
          completedAt: migrationTimestamp,
          targets,
          evaluation: null,
          summary: summarizeTargets(targets)
        }
      : rewritten,
    cancelledExecutionResourceId:
      typeof rewritten.id === 'string' ? rewritten.id : null,
    terminalStatus: changed ? terminalStatus : null
  };
};

const rewriteLegacyCheck = (
  value: unknown,
  runtimeRegionId: string,
  resolveRegionPack: (regionPackId: string) => string[]
) => {
  if (!isRecord(value) || typeof value.regionPackId !== 'string') {
    return value;
  }

  const sourceRegionPackId = value.regionPackId;
  const sourceRegions = resolveRegionPack(sourceRegionPackId);
  const safeSingleton = sourceRegions.length === 1 && sourceRegions[0] === runtimeRegionId;
  const reason = resolveMigrationReason(sourceRegions, safeSingleton);
  const { regionPackId: _removed, ...rest } = value;

  return {
    ...rest,
    schedule: safeSingleton ? (value.schedule ?? null) : null,
    locationMigration: {
      sourceRegionPackId,
      sourceRegions,
      runtimeRegionId,
      status: safeSingleton ? 'applied' : 'requires_review',
      reason,
      acknowledgedAt: null
    }
  };
};

/**
 * Visits encrypted payload rows through bounded keyset batches.
 *
 * This helper owns and finalizes both read statements. The visitor returns
 * `true` to continue or `false` to stop after the current row.
 */
const visitPayloadRowsInBatches = ({
  readFirstBatch,
  readNextBatch,
  parse,
  visit
}: {
  readFirstBatch: FirstBatchStatement;
  readNextBatch: NextBatchStatement;
  parse: (payload: string) => unknown;
  visit: (row: PersistedPayloadRow, value: unknown) => boolean;
}) => {
  let lastRowId: number | null = null;

  try {
    while (true) {
      const rows: PersistedPayloadRow[] = lastRowId === null
        ? readFirstBatch.all()
        : readNextBatch.all(lastRowId);
      if (rows.length === 0) {
        return;
      }

      for (const row of rows) {
        if (!visit(row, parse(row.payload_json))) {
          return;
        }
        lastRowId = row.rowid;
      }
    }
  } finally {
    readFirstBatch.finalize();
    readNextBatch.finalize();
  }
};

const rewriteJobRowsInBatches = ({
  database,
  migrationTimestamp,
  parse,
  stringify
}: {
  database: Parameters<SqliteMigration['up']>[0];
  migrationTimestamp: string;
  parse: (payload: string) => unknown;
  stringify: (value: unknown) => string;
}) => {
  // Keep the first read separate instead of assuming a lower rowid bound for legacy databases.
  const readFirstBatch = database.query<PersistedPayloadRow, []>(`
    SELECT rowid, payload_json
    FROM jobs
    ORDER BY rowid
    LIMIT ${migrationBatchSize}
  `);
  const readNextBatch = database.query<PersistedPayloadRow, [number]>(`
    SELECT rowid, payload_json
    FROM jobs
    WHERE rowid > ?
    ORDER BY rowid
    LIMIT ${migrationBatchSize}
  `);
  const update = database.query<never, [string, number]>(
    'UPDATE jobs SET payload_json = ? WHERE rowid = ?'
  );
  const updateTerminalIndex = database.query<never, [string, string, number]>(
    'UPDATE jobs SET status = ?, updated_at = ? WHERE rowid = ?'
  );
  const cancelActiveExecution = database.query<never, [string, string, string]>(`
    UPDATE execution_jobs
    SET status = 'cancelled',
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = ?,
        completed_at = ?
    WHERE kind = 'network_probe'
      AND resource_id = ?
      AND status NOT IN ('succeeded', 'failed', 'cancelled')
  `);

  try {
    visitPayloadRowsInBatches({
      readFirstBatch,
      readNextBatch,
      parse,
      visit(row, value) {
        const rewritten = finishLegacyMultiRegionJob(
          value,
          migrationTimestamp
        );
        if (rewritten.value !== value) {
          update.run(stringify(rewritten.value), row.rowid);
        }
        if (rewritten.terminalStatus) {
          updateTerminalIndex.run(
            rewritten.terminalStatus,
            migrationTimestamp,
            row.rowid
          );
        }
        if (rewritten.cancelledExecutionResourceId) {
          cancelActiveExecution.run(
            migrationTimestamp,
            migrationTimestamp,
            rewritten.cancelledExecutionResourceId
          );
        }
        return true;
      }
    });
  } finally {
    update.finalize();
    updateTerminalIndex.finalize();
    cancelActiveExecution.finalize();
  }
};

const visitCheckRowsInBatches = ({
  database,
  parse,
  visit
}: {
  database: Parameters<SqliteMigration['up']>[0];
  parse: (payload: string) => unknown;
  visit: (row: PersistedPayloadRow, value: unknown) => boolean;
}) => {
  // Keep the first read separate instead of assuming a lower rowid bound for legacy databases.
  const readFirstBatch = database.query<PersistedPayloadRow, []>(`
    SELECT rowid, payload_json
    FROM saved_entities
    WHERE kind = 'check_profile'
    ORDER BY rowid
    LIMIT ${migrationBatchSize}
  `);
  const readNextBatch = database.query<PersistedPayloadRow, [number]>(`
    SELECT rowid, payload_json
    FROM saved_entities
    WHERE kind = 'check_profile' AND rowid > ?
    ORDER BY rowid
    LIMIT ${migrationBatchSize}
  `);
  visitPayloadRowsInBatches({
    readFirstBatch,
    readNextBatch,
    parse,
    visit
  });
};

const hasLegacyChecksInBatches = ({
  database,
  parse
}: {
  database: Parameters<SqliteMigration['up']>[0];
  parse: (payload: string) => unknown;
}) => {
  let found = false;
  visitCheckRowsInBatches({
    database,
    parse,
    visit(_row, value) {
      if (isRecord(value) && typeof value.regionPackId === 'string') {
        found = true;
        return false;
      }
      return true;
    }
  });
  return found;
};

const rewriteCheckRowsInBatches = ({
  database,
  runtimeRegionId,
  migrationTimestamp,
  parse,
  stringify
}: {
  database: Parameters<SqliteMigration['up']>[0];
  runtimeRegionId: string;
  migrationTimestamp: string;
  parse: (payload: string) => unknown;
  stringify: (value: unknown) => string;
}) => {
  const readRegionPack = database.query<PersistedPayloadRow, [string]>(`
    SELECT rowid, payload_json
    FROM saved_entities
    WHERE kind = 'region_pack' AND id = ?
    LIMIT 1
  `);
  const update = database.query<never, [string, number]>(
    'UPDATE saved_entities SET payload_json = ? WHERE rowid = ?'
  );
  const cancelActiveExecutions = database.query<never, [string, string, string]>(`
    UPDATE execution_jobs
    SET status = 'cancelled',
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = ?,
        completed_at = ?
    WHERE kind IN ('network_probe', 'webhook_delivery')
      AND status NOT IN ('succeeded', 'failed', 'cancelled')
      AND resource_id IN (
        SELECT id
        FROM check_profile_runs
        WHERE profile_id = ?
      )
  `);
  const regionPackCache = new Map<string, string[]>();
  const resolveRegionPack = (regionPackId: string) => {
    const cached = regionPackCache.get(regionPackId);
    if (cached) {
      regionPackCache.delete(regionPackId);
      regionPackCache.set(regionPackId, cached);
      return cached;
    }

    const row = readRegionPack.get(regionPackId);
    let regions: string[] = [];
    if (row) {
      const value = parse(row.payload_json);
      if (isRecord(value)) {
        regions = toStringArray(value.regions) ?? [];
      }
    }
    regionPackCache.set(regionPackId, regions);
    if (regionPackCache.size > migrationBatchSize) {
      const oldestRegionPackId = regionPackCache.keys().next().value;
      if (oldestRegionPackId !== undefined) {
        regionPackCache.delete(oldestRegionPackId);
      }
    }
    return regions;
  };

  try {
    visitCheckRowsInBatches({
      database,
      parse,
      visit(row, value) {
        const rewritten = rewriteLegacyCheck(value, runtimeRegionId, resolveRegionPack);
        if (rewritten !== value) {
          update.run(stringify(rewritten), row.rowid);
          if (
            isRecord(rewritten)
            && typeof rewritten.id === 'string'
            && isRecord(rewritten.locationMigration)
            && rewritten.locationMigration.status === 'requires_review'
          ) {
            cancelActiveExecutions.run(
              migrationTimestamp,
              migrationTimestamp,
              rewritten.id
            );
          }
        }
        return true;
      }
    });
  } finally {
    readRegionPack.finalize();
    update.finalize();
    cancelActiveExecutions.finalize();
  }
};

export const singleRegionStoredDataMigration: SqliteMigration = {
  id: '20260730_005_single_region_stored_data',
  up(database, context) {
    const parse = (payload: string) => context.storageCrypto.parse(payload);
    const stringify = (value: unknown) => context.storageCrypto.stringify(value);

    const runtimeRegionId = context.runtimeRegionId;
    if (!runtimeRegionId && hasLegacyChecksInBatches({ database, parse })) {
      throw new Error(
        'SELFHOST_REGION_ID is required to migrate saved Checks from legacy Region Sets'
      );
    }

    const migrationTimestamp = new Date().toISOString();
    rewriteJobRowsInBatches({
      database,
      migrationTimestamp,
      parse,
      stringify
    });
    if (runtimeRegionId) {
      rewriteCheckRowsInBatches({
        database,
        runtimeRegionId,
        migrationTimestamp,
        parse,
        stringify
      });
    }
  }
};
