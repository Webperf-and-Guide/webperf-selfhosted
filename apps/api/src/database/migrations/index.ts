import { encryptedPayloadMigration } from './20260722_001_encrypted_payloads_v2';
import { executionJobsMigration } from './20260722_002_execution_jobs';
import { browserAuditArtifactsMigration } from './20260722_003_browser_audit_artifacts';
import { initialSchemaMigration } from './20260722_000_initial_schema';
import { regionalExecutionTargetsMigration } from './20260729_004_regional_execution_targets';
import { singleRegionStoredDataMigration } from './20260730_005_single_region_stored_data';

export const sqliteMigrations = [
  initialSchemaMigration,
  encryptedPayloadMigration,
  executionJobsMigration,
  browserAuditArtifactsMigration,
  regionalExecutionTargetsMigration,
  singleRegionStoredDataMigration
] as const;

export type { SqliteMigration, SqliteMigrationContext } from './types';
