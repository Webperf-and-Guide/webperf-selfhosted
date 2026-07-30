import type { SqliteMigration } from './types';
import { latencyJobDetailSchema } from '@webperf/contracts';
import { deriveJobStatus, summarizeTargets } from '@webperf/report-core';

const migrationBatchSize = 100;

type LinkedJobRow = {
  rowid: number;
  payload_json: string;
};

const terminalizeLinkedDomainJobs = (
  database: Parameters<SqliteMigration['up']>[0],
  storageCrypto: Parameters<SqliteMigration['up']>[1]['storageCrypto'],
  migrationTimestamp: string
) => {
  const firstBatch = database.query<LinkedJobRow, []>(`
    SELECT job.rowid, job.payload_json
    FROM jobs AS job
    WHERE EXISTS (
      SELECT 1
      FROM regional_execution_targets AS target_link
      JOIN execution_jobs AS execution
        ON execution.id = target_link.execution_job_id
      WHERE target_link.job_id = job.id
        AND execution.status IN ('queued', 'leased', 'running')
    )
    ORDER BY job.rowid
    LIMIT ${migrationBatchSize}
  `);
  const nextBatch = database.query<LinkedJobRow, [number]>(`
    SELECT job.rowid, job.payload_json
    FROM jobs AS job
    WHERE job.rowid > ?
      AND EXISTS (
        SELECT 1
        FROM regional_execution_targets AS target_link
        JOIN execution_jobs AS execution
          ON execution.id = target_link.execution_job_id
        WHERE target_link.job_id = job.id
          AND execution.status IN ('queued', 'leased', 'running')
      )
    ORDER BY job.rowid
    LIMIT ${migrationBatchSize}
  `);
  const updateJob = database.query<never, [string, string, string, number]>(`
    UPDATE jobs
    SET status = ?,
        updated_at = ?,
        payload_json = ?
    WHERE rowid = ?
  `);
  const terminalizeInvalidJobIndex = database.query<
    never,
    [string, string, number]
  >(`
    UPDATE jobs
    SET status = ?,
        updated_at = ?
    WHERE rowid = ?
  `);
  let lastRowId: number | null = null;

  try {
    while (true) {
      const rows: LinkedJobRow[] = lastRowId === null
        ? firstBatch.all()
        : nextBatch.all(lastRowId);
      if (rows.length === 0) {
        return;
      }

      for (const row of rows) {
        lastRowId = row.rowid;
        let decryptedPayload: unknown;
        try {
          decryptedPayload = storageCrypto.parse(row.payload_json);
        } catch {
          // Preserve unreadable bytes for operator recovery while ensuring the
          // SQL index cannot keep a retired execution active indefinitely.
          terminalizeInvalidJobIndex.run(
            'failed',
            migrationTimestamp,
            row.rowid
          );
          continue;
        }
        const parsedJob = latencyJobDetailSchema.safeParse(decryptedPayload);
        if (!parsedJob.success) {
          // Keep the encrypted historical payload available for operator
          // recovery, but make the SQL index terminal so retention and queue
          // views cannot treat an unreadable retired job as active forever.
          terminalizeInvalidJobIndex.run(
            'failed',
            migrationTimestamp,
            row.rowid
          );
          continue;
        }
        const job = parsedJob.data;
        let changed = false;
        const targets = job.targets.map((target) => {
          if (target.status === 'succeeded' || target.status === 'failed') {
            return target;
          }

          changed = true;
          return {
            ...target,
            status: 'failed' as const,
            latencyMs: null,
            statusCode: null,
            success: false,
            probeImpl: null,
            measurement: null,
            slotId: null,
            errorCode: 'execution_cancelled',
            errorClass: 'terminal' as const,
            errorMessage:
              'Regional Runtime execution was retired before producing a result',
            finishedAt: migrationTimestamp,
            updatedAt: migrationTimestamp
          };
        });

        if (changed) {
          const status = deriveJobStatus(targets);
          updateJob.run(
            status,
            migrationTimestamp,
            storageCrypto.stringify({
              ...job,
              status,
              completedAt: migrationTimestamp,
              targets,
              evaluation: null,
              summary: summarizeTargets(targets)
            }),
            row.rowid
          );
        }
      }
    }
  } finally {
    firstBatch.finalize();
    nextBatch.finalize();
    updateJob.finalize();
    terminalizeInvalidJobIndex.finalize();
  }
};

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
  up(database, { storageCrypto }) {
    const migrationTimestamp = new Date().toISOString();
    terminalizeLinkedDomainJobs(database, storageCrypto, migrationTimestamp);
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
