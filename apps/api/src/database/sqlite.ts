import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { sqliteMigrations } from './migrations';
import type { SqliteMigrationContext } from './migrations';

const schemaMigrationsTable = 'schema_migrations';
const migrationIds = sqliteMigrations.map((migration) => migration.id);

for (let index = 1; index < migrationIds.length; index += 1) {
  const previous = migrationIds[index - 1]!;
  const current = migrationIds[index]!;

  if (previous >= current) {
    throw new Error(`SQLite migration manifest must be unique and ordered: ${previous}, ${current}`);
  }
}

type AppliedMigrationRow = {
  id: string;
  applied_at: string;
};

export type SqliteMigrationState = {
  applied: AppliedMigrationRow[];
  pending: string[];
  unknown: string[];
};

export type SqliteMigrationResult = SqliteMigrationState & {
  appliedNow: string[];
};

export type SqliteMigrationContextProvider =
  | SqliteMigrationContext
  | (() => SqliteMigrationContext);

export class IncompatibleSqliteSchemaError extends Error {
  override readonly name = 'IncompatibleSqliteSchemaError';

  constructor(migrationIds: string[]) {
    super(`Database contains migrations unknown to this WebPerf version: ${migrationIds.join(', ')}`);
  }
}

export class SqlitePragmaError extends Error {
  override readonly name = 'SqlitePragmaError';
}

export class SqliteMigrationError extends Error {
  override readonly name = 'SqliteMigrationError';

  constructor(readonly migrationId: string, options?: ErrorOptions) {
    super(`SQLite migration failed: ${migrationId}`, options);
  }
}

export const openSqliteDatabase = (
  databasePath: string,
  options: { readonly?: boolean; create?: boolean } = {}
) => {
  const readonly = options.readonly ?? false;

  if (!readonly && databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  }

  const database = new Database(databasePath, {
    readonly,
    readwrite: !readonly,
    create: readonly ? false : (options.create ?? true),
    strict: true
  });

  try {
    configureSqliteConnection(database, { databasePath, readonly });
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
};

export const configureSqliteConnection = (
  database: Database,
  { databasePath, readonly = false }: { databasePath: string; readonly?: boolean }
) => {
  database.exec('PRAGMA busy_timeout = 5000;');
  database.exec('PRAGMA foreign_keys = ON;');

  if (!readonly) {
    if (databasePath !== ':memory:') {
      const journalMode = database
        .query<{ journal_mode: string }, []>('PRAGMA journal_mode = WAL')
        .get()?.journal_mode;

      if (journalMode?.toLowerCase() !== 'wal') {
        throw new SqlitePragmaError(`Unable to enable SQLite WAL mode; current mode is ${journalMode ?? 'unknown'}`);
      }
    }

    database.exec('PRAGMA synchronous = NORMAL;');
    const synchronous = database
      .query<{ synchronous: number }, []>('PRAGMA synchronous')
      .get()?.synchronous;

    if (synchronous !== 1) {
      throw new SqlitePragmaError(
        `Unable to configure SQLite synchronous mode; current mode is ${synchronous ?? 'unknown'}`
      );
    }
    // Keep the SQLite default explicit so WAL growth policy remains visible and
    // stable across runtime upgrades. Busy readers may still defer checkpoints.
    database.exec('PRAGMA wal_autocheckpoint = 1000;');
  }

  const foreignKeys = database
    .query<{ foreign_keys: number }, []>('PRAGMA foreign_keys')
    .get()?.foreign_keys;

  if (foreignKeys !== 1) {
    throw new SqlitePragmaError('Unable to enable SQLite foreign key enforcement');
  }

  const busyTimeout = database
    .query<{ timeout: number }, []>('PRAGMA busy_timeout')
    .get()?.timeout;

  if (busyTimeout !== 5_000) {
    throw new SqlitePragmaError(`Unable to configure SQLite busy timeout; current timeout is ${busyTimeout ?? 'unknown'}`);
  }

  if (!readonly) {
    const walAutocheckpoint = database
      .query<{ wal_autocheckpoint: number }, []>('PRAGMA wal_autocheckpoint')
      .get()?.wal_autocheckpoint;

    if (walAutocheckpoint !== 1_000) {
      throw new SqlitePragmaError(
        `Unable to configure SQLite WAL autocheckpoint; current threshold is ${walAutocheckpoint ?? 'unknown'}`
      );
    }
  }
};

export const getSqliteMigrationState = (database: Database): SqliteMigrationState => {
  const hasMigrationTable = Boolean(
    database
      .query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
      )
      .get(schemaMigrationsTable)
  );
  const applied = hasMigrationTable
    ? database
        .query<AppliedMigrationRow, []>(
          'SELECT id, applied_at FROM schema_migrations ORDER BY applied_at, id'
        )
        .all()
    : [];
  const knownIds = new Set(migrationIds);
  const appliedIds = new Set(applied.map((migration) => migration.id));

  return {
    applied,
    pending: migrationIds.filter((migrationId) => !appliedIds.has(migrationId)),
    unknown: applied
      .map((migration) => migration.id)
      .filter((migrationId) => !knownIds.has(migrationId))
  };
};

export const applySqliteMigrations = (
  database: Database,
  contextProvider: SqliteMigrationContextProvider,
  options: {
    now?: () => Date;
    beforeMigrate?: (pendingMigrationIds: string[]) => void;
  } = {}
): SqliteMigrationResult => {
  const initialState = getSqliteMigrationState(database);

  if (initialState.unknown.length > 0) {
    throw new IncompatibleSqliteSchemaError(initialState.unknown);
  }

  if (initialState.pending.length > 0) {
    options.beforeMigrate?.([...initialState.pending]);
  }

  const now = options.now ?? (() => new Date());
  const migrate = database.transaction(() => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const lockedState = getSqliteMigrationState(database);

    if (lockedState.unknown.length > 0) {
      throw new IncompatibleSqliteSchemaError(lockedState.unknown);
    }

    const appliedNow: string[] = [];
    let context: SqliteMigrationContext | undefined;

    for (const migration of sqliteMigrations) {
      if (!lockedState.pending.includes(migration.id)) {
        continue;
      }

      try {
        context ??= typeof contextProvider === 'function'
          ? contextProvider()
          : contextProvider;
        migration.up(database, context);
      } catch (cause) {
        throw new SqliteMigrationError(migration.id, { cause });
      }
      database
        .query<never, [string, string]>(
          'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)'
        )
        .run(migration.id, now().toISOString());
      appliedNow.push(migration.id);
    }

    return appliedNow;
  });

  const appliedNow = migrate.immediate();

  const finalState = getSqliteMigrationState(database);
  return { ...finalState, appliedNow };
};
