import type { SqliteMigration } from './types';

// Historical compatibility migration. Regional Runtime was removed after
// v0.3.0, but released databases must keep the original migration chain so
// upgrades remain deterministic and previously created rows can be retained
// and cleaned safely.
export const regionalExecutionTargetsMigration: SqliteMigration = {
  id: '20260729_004_regional_execution_targets',
  up(database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS regional_execution_targets (
        regional_execution_id TEXT NOT NULL,
        execution_job_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        PRIMARY KEY (regional_execution_id, job_id)
      );

      CREATE INDEX IF NOT EXISTS regional_execution_targets_execution_idx
        ON regional_execution_targets (execution_job_id);

      CREATE INDEX IF NOT EXISTS regional_execution_targets_job_idx
        ON regional_execution_targets (job_id);
    `);
  }
};
