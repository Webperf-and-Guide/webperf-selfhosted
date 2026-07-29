import { encryptedPayloadMigration } from './20260722_001_encrypted_payloads_v2';
import { executionJobsMigration } from './20260722_002_execution_jobs';
import { browserAuditArtifactsMigration } from './20260722_003_browser_audit_artifacts';
import { initialSchemaMigration } from './20260722_000_initial_schema';
import { regionalExecutionTargetsMigration } from './20260729_004_regional_execution_targets';

export const sqliteMigrations = [
  initialSchemaMigration,
  encryptedPayloadMigration,
  executionJobsMigration,
  browserAuditArtifactsMigration,
  regionalExecutionTargetsMigration
] as const;

export type { SqliteMigration, SqliteMigrationContext } from './types';
