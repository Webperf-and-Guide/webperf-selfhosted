import type { SqliteMigration } from './types';

export const initialSchemaMigration: SqliteMigration = {
  id: '20260722_000_initial_schema',
  up(database) {
    database.exec(`
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
  }
};
