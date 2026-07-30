import type { SqliteMigration } from './types';

export const executionJobStartedAtMigration: SqliteMigration = {
  id: '20260730_006_execution_job_started_at',
  up(database) {
    database.exec(`
      ALTER TABLE execution_jobs ADD COLUMN started_at TEXT;

      UPDATE execution_jobs
      SET started_at = updated_at
      WHERE status IN ('leased', 'running');
    `);
  }
};
