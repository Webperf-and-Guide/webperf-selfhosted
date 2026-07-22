import type { SqliteMigration } from './types';

export const browserAuditArtifactsMigration: SqliteMigration = {
  id: '20260722_003_browser_audit_artifacts',
  up(database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS browser_audit_artifacts (
        id TEXT PRIMARY KEY,
        audit_id TEXT NOT NULL,
        registry_version TEXT NOT NULL,
        kind TEXT NOT NULL,
        filename TEXT NOT NULL,
        content_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        storage_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS browser_audit_artifacts_audit_idx
        ON browser_audit_artifacts (audit_id, created_at, id);

      CREATE TRIGGER IF NOT EXISTS browser_audit_artifacts_limit_before_insert
      BEFORE INSERT ON browser_audit_artifacts
      WHEN (
        SELECT COUNT(*)
        FROM browser_audit_artifacts
        WHERE audit_id = NEW.audit_id
      ) >= 50
      BEGIN
        SELECT RAISE(ABORT, 'browser_audit_artifact_limit');
      END;
    `);
  }
};
