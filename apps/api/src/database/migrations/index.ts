import { encryptedPayloadMigration } from './20260722_001_encrypted_payloads_v2';
import { executionJobsMigration } from './20260722_002_execution_jobs';
import { initialSchemaMigration } from './20260722_000_initial_schema';

export const sqliteMigrations = [
  initialSchemaMigration,
  encryptedPayloadMigration,
  executionJobsMigration
] as const;

export type { SqliteMigration, SqliteMigrationContext } from './types';
