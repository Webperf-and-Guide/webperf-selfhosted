import type { SqliteMigration } from './types';

/**
 * Regional Runtime was published briefly before the probe-first managed
 * boundary replaced it. Its execution payload guards are no longer part of
 * the public contract, so unfinished jobs created through that handoff must
 * not become claimable by the standalone executor after an upgrade.
 *
 * The historical target-link table is retained for database compatibility and
 * provides an unambiguous association without decrypting legacy payloads.
 */
export const retiredRegionalExecutionJobsMigration: SqliteMigration = {
  id: '20260730_007_retired_regional_execution_jobs',
  up(database) {
    const migrationTimestamp = new Date().toISOString();
    database.query<never, [string, string]>(`
      UPDATE execution_jobs
      SET status = 'cancelled',
          lease_owner = NULL,
          lease_expires_at = NULL,
          updated_at = ?,
          completed_at = ?
      WHERE status IN ('queued', 'leased', 'running')
        AND id IN (
          SELECT execution_job_id
          FROM regional_execution_targets
        )
    `).run(migrationTimestamp, migrationTimestamp);
  }
};
