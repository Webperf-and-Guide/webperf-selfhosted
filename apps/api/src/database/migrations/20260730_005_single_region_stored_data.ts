import type { SqliteMigration } from './types';

const historicalMultiRegionId = 'historical-multi-region';

type PersistedPayloadRow = {
  rowid: number;
  id?: string;
  payload_json: string;
};

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringArray = (value: unknown) =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : null;

const rewriteLegacyJob = (value: unknown) => {
  if (!isRecord(value) || 'region' in value) {
    return value;
  }

  const selectedRegions = stringArray(value.selectedRegions);
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

    const regions = stringArray(value.regions);
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
  const reason = sourceRegions.length === 0
    ? 'legacy_region_pack_missing'
    : sourceRegions.length > 1
      ? 'legacy_multi_region'
      : safeSingleton
        ? 'singleton_matches_runtime'
        : 'legacy_region_mismatch';
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

const rewriteTable = ({
  rows,
  rewrite,
  parse,
  stringify,
  update
}: {
  rows: PersistedPayloadRow[];
  rewrite: (value: unknown) => unknown;
  parse: (payload: string) => unknown;
  stringify: (value: unknown) => string;
  update: { run(payload: string, rowId: number): unknown };
}) => {
  for (const row of rows) {
    const value = parse(row.payload_json);
    const rewritten = rewrite(value);
    if (rewritten !== value) {
      update.run(stringify(rewritten), row.rowid);
    }
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

    const jobRows = database
      .query<PersistedPayloadRow, []>('SELECT rowid, payload_json FROM jobs ORDER BY rowid')
      .all();
    const updateJob = database.query('UPDATE jobs SET payload_json = ? WHERE rowid = ?');
    const checkRows = database
      .query<PersistedPayloadRow, []>(`
        SELECT rowid, payload_json
        FROM saved_entities
        WHERE kind = 'check_profile'
        ORDER BY rowid
      `)
      .all();
    const hasLegacyChecks = checkRows.some((row) => {
      const value = parse(row.payload_json);
      return isRecord(value) && typeof value.regionPackId === 'string';
    });
    if (hasLegacyChecks && !context.runtimeRegionId) {
      throw new Error(
        'SELFHOST_REGION_ID is required to migrate saved Checks from legacy Region Sets'
      );
    }
    const runtimeRegionId = context.runtimeRegionId;
    const updateCheck = database.query('UPDATE saved_entities SET payload_json = ? WHERE rowid = ?');

    try {
      rewriteTable({
        rows: jobRows,
        rewrite: rewriteLegacyJob,
        parse,
        stringify,
        update: updateJob
      });
      rewriteTable({
        rows: checkRows,
        rewrite: (value) => runtimeRegionId
          ? rewriteLegacyCheck(value, runtimeRegionId, regionPacks)
          : value,
        parse,
        stringify,
        update: updateCheck
      });
    } finally {
      updateJob.finalize();
      updateCheck.finalize();
    }
  }
};
