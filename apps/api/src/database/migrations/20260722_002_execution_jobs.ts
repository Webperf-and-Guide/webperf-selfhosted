import type { SqliteMigration } from './types';

export const executionJobsMigration: SqliteMigration = {
  id: '20260722_002_execution_jobs',
  up(database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS execution_jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('network_probe', 'browser_audit', 'webhook_delivery')),
        resource_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'leased', 'running', 'succeeded', 'failed', 'cancelled')),
        lease_owner TEXT,
        lease_expires_at TEXT,
        attempt_count INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL CHECK (max_attempts > 0 AND max_attempts <= 20),
        available_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        CHECK (attempt_count >= 0 AND attempt_count <= max_attempts),
        CHECK (
          (
            status IN ('leased', 'running')
            AND lease_owner IS NOT NULL
            AND lease_expires_at IS NOT NULL
            AND completed_at IS NULL
          )
          OR (
            status = 'queued'
            AND lease_owner IS NULL
            AND lease_expires_at IS NULL
            AND completed_at IS NULL
          )
          OR (
            status IN ('succeeded', 'failed', 'cancelled')
            AND lease_owner IS NULL
            AND lease_expires_at IS NULL
            AND completed_at IS NOT NULL
          )
        )
      );

      CREATE INDEX IF NOT EXISTS execution_jobs_claim_idx
        ON execution_jobs (status, available_at, lease_expires_at, created_at);

      CREATE INDEX IF NOT EXISTS execution_jobs_resource_idx
        ON execution_jobs (kind, resource_id, created_at DESC);
    `);
  }
};
