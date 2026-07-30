import type { SqliteMigration } from './types';
import type { CheckProfileLocationMigrationReason } from '@webperf/contracts';

const historicalMultiRegionId = 'historical-multi-region';
const migrationBatchSize = 100;

type PersistedPayloadRow = {
  rowid: number;
  id?: string;
  payload_json: string;
};

type JsonRecord = Record<string, unknown>;

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

const readLegacyRegionPacks = (
  rows: PersistedPayloadRow[],
  parse: (payload: string) => unknown
) => {
  const packs = new Map<string, string[]>();

  for (const row of rows) {
    const value = parse(row.payload_json);
    if (!isRecord(value) || typeof value.id !== 'string') {
      continue;
    }

    const regions = toStringArray(value.regions);
    if (regions && regions.length > 0) {
      packs.set(value.id, regions);
    }
  }

  return packs;
};

const rewriteLegacyCheck = (
  value: unknown,
  runtimeRegionId: string,
  regionPacks: Map<string, string[]>
) => {
  if (!isRecord(value) || typeof value.regionPackId !== 'string') {
    return value;
  }

  const sourceRegionPackId = value.regionPackId;
  const sourceRegions = regionPacks.get(sourceRegionPackId) ?? [];
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

const rewriteJobRowsInBatches = ({
  database,
  rewrite,
  parse,
  stringify
}: {
  database: Parameters<SqliteMigration['up']>[0];
  rewrite: (value: unknown) => unknown;
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
  let lastRowId: number | null = null;

  try {
    while (true) {
      const rows: PersistedPayloadRow[] = lastRowId === null
        ? readFirstBatch.all()
        : readNextBatch.all(lastRowId);
      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        const value = parse(row.payload_json);
        const rewritten = rewrite(value);
        if (rewritten !== value) {
          update.run(stringify(rewritten), row.rowid);
        }
        lastRowId = row.rowid;
      }
    }
  } finally {
    readFirstBatch.finalize();
    readNextBatch.finalize();
    update.finalize();
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
  regionPacks,
  parse,
  stringify
}: {
  database: Parameters<SqliteMigration['up']>[0];
  runtimeRegionId: string;
  regionPacks: Map<string, string[]>;
  parse: (payload: string) => unknown;
  stringify: (value: unknown) => string;
}) => {
  const update = database.query<never, [string, number]>(
    'UPDATE saved_entities SET payload_json = ? WHERE rowid = ?'
  );
  try {
    visitCheckRowsInBatches({
      database,
      parse,
      visit(row, value) {
        const rewritten = rewriteLegacyCheck(value, runtimeRegionId, regionPacks);
        if (rewritten !== value) {
          update.run(stringify(rewritten), row.rowid);
        }
        return true;
      }
    });
  } finally {
    update.finalize();
  }
};

export const singleRegionStoredDataMigration: SqliteMigration = {
  id: '20260730_005_single_region_stored_data',
  up(database, context) {
    const parse = (payload: string) => context.storageCrypto.parse(payload);
    const stringify = (value: unknown) => context.storageCrypto.stringify(value);
    const regionPackRows = database
      .query<PersistedPayloadRow, []>(`
        SELECT rowid, id, payload_json
        FROM saved_entities
        WHERE kind = 'region_pack'
        ORDER BY rowid
      `)
      .all();
    const regionPacks = readLegacyRegionPacks(regionPackRows, parse);

    const runtimeRegionId = context.runtimeRegionId;
    if (!runtimeRegionId && hasLegacyChecksInBatches({ database, parse })) {
      throw new Error(
        'SELFHOST_REGION_ID is required to migrate saved Checks from legacy Region Sets'
      );
    }

    rewriteJobRowsInBatches({
      database,
      rewrite: rewriteLegacyJob,
      parse,
      stringify
    });
    if (runtimeRegionId) {
      rewriteCheckRowsInBatches({
        database,
        runtimeRegionId,
        regionPacks,
        parse,
        stringify
      });
    }
  }
};
