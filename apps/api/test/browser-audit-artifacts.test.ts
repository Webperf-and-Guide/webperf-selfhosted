import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ArtifactStoreValidationError,
  LocalBrowserAuditArtifactStore,
  normalizeArtifactFilename
} from '../src/browser-audit-artifact-store';
import {
  issueBrowserAuditUploadToken,
  verifyBrowserAuditUploadToken
} from '../src/browser-audit-upload-token';
import { createSqliteJobRepository } from '../src/repository';
import { cleanupSqliteRetention } from '../src/database/operations';

const tempDirectories: string[] = [];

const createTempDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), 'webperf-artifact-test-'));
  tempDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Browser Audit upload tokens', () => {
  test('binds a short-lived token to its signed claims and supports secret rotation', () => {
    const now = new Date('2026-07-22T00:00:00.000Z');
    const token = issueBrowserAuditUploadToken({
      secret: 'current-internal-secret',
      auditId: 'audit_token',
      executionJobId: 'exec_audit_token',
      leaseOwner: 'executor-token',
      attemptCount: 2,
      expiresAt: new Date('2026-07-22T00:15:00.000Z'),
      maxArtifactBytes: 25_000_000,
      now
    });

    expect(verifyBrowserAuditUploadToken({
      token,
      secrets: ['next-internal-secret', 'current-internal-secret'],
      now: new Date('2026-07-22T00:14:59.000Z')
    })).toMatchObject({
      version: 'v1',
      auditId: 'audit_token',
      executionJobId: 'exec_audit_token',
      leaseOwner: 'executor-token',
      attemptCount: 2,
      maxArtifactBytes: 25_000_000
    });
    expect(verifyBrowserAuditUploadToken({
      token: `${token.slice(0, -1)}x`,
      secrets: ['current-internal-secret'],
      now
    })).toBeNull();
    expect(verifyBrowserAuditUploadToken({
      token,
      secrets: ['current-internal-secret'],
      now: new Date('2026-07-22T00:15:00.000Z')
    })).toBeNull();
    expect(verifyBrowserAuditUploadToken({
      token,
      secrets: [undefined],
      now
    })).toBeNull();
  });

  test('refuses upload grants longer than the hard one-hour limit', () => {
    expect(() => issueBrowserAuditUploadToken({
      secret: 'current-internal-secret',
      auditId: 'audit_token',
      executionJobId: 'exec_audit_token',
      leaseOwner: 'executor-token',
      attemptCount: 1,
      expiresAt: new Date('2026-07-22T01:00:00.001Z'),
      maxArtifactBytes: 25_000_000,
      now: new Date('2026-07-22T00:00:00.000Z')
    })).toThrow('lifetime');
  });
});

describe('local Browser Audit artifact storage', () => {
  test('streams exact bytes into a private file and reconciles only orphaned entries', async () => {
    const root = join(createTempDirectory(), 'artifacts');
    const store = new LocalBrowserAuditArtifactStore(root);
    const body = new TextEncoder().encode('{"score":0.91}');
    const stored = await store.write({
      auditId: 'audit_store',
      artifactId: 'artifact_report',
      body: new Response(body).body,
      expectedBytes: body.byteLength,
      maxBytes: 1_024
    });

    expect(stored.storageKey).toBe('audit_store/artifact_report');
    expect(stored.byteSize).toBe(body.byteLength);
    expect(stored.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await new Response(
      (await store.openDownload(stored.storageKey, body.byteLength)).body
    ).text()).toBe('{"score":0.91}');

    mkdirSync(join(root, 'audit_orphan'));
    writeFileSync(join(root, 'audit_orphan', 'artifact_orphan'), 'orphan');
    const reconciled = await store.reconcile(new Set([stored.storageKey]));
    expect(reconciled.removedFiles).toBe(1);
    expect(reconciled.removedDirectories).toBe(1);
    expect(await new Response(
      (await store.openDownload(stored.storageKey, body.byteLength)).body
    ).text()).toBe('{"score":0.91}');
  });

  test('rejects traversal, symlinks, declared-size mismatches, and byte-limit overflow', async () => {
    expect(() => normalizeArtifactFilename('../report.html'))
      .toThrow(ArtifactStoreValidationError);
    expect(normalizeArtifactFilename('  Résumé report.html  ')).toBe('R_sum_-report.html');

    const directory = createTempDirectory();
    const root = join(directory, 'artifacts');
    mkdirSync(root);
    symlinkSync(directory, join(root, 'audit_link'));
    const store = new LocalBrowserAuditArtifactStore(root);

    await expect(store.write({
      auditId: 'audit_link',
      artifactId: 'artifact_report',
      body: new Response('data').body,
      expectedBytes: 4,
      maxBytes: 10
    })).rejects.toThrow('unsafe');
    await expect(store.write({
      auditId: 'audit_safe',
      artifactId: 'artifact_mismatch',
      body: new Response('data').body,
      expectedBytes: 5,
      maxBytes: 10
    })).rejects.toThrow('declared byte size');
    await expect(store.write({
      auditId: 'audit_safe',
      artifactId: 'artifact_large',
      body: new Response('data').body,
      expectedBytes: 4,
      maxBytes: 3
    })).rejects.toMatchObject({ status: 413 });
  });
});

describe('Browser Audit artifact indexes', () => {
  test('persists metadata in SQLite without storing binary payloads', () => {
    const databasePath = join(createTempDirectory(), 'webperf.sqlite');
    const repository = createSqliteJobRepository({
      databasePath,
      encryptionSecret: 'artifact-index-encryption-secret'
    });
    const artifact = {
      id: 'artifact_index',
      auditId: 'audit_index',
      registryVersion: 'v1' as const,
      kind: 'lighthouse-json',
      filename: 'report.json',
      contentType: 'application/json',
      byteSize: 128,
      sha256: 'a'.repeat(64),
      storageKey: 'audit_index/artifact_index',
      createdAt: '2026-07-22T00:00:00.000Z'
    };

    expect(repository.saveBrowserAuditArtifact(artifact)).toBe(true);
    expect(repository.saveBrowserAuditArtifact(artifact)).toBe(false);
    expect(repository.getBrowserAuditArtifact('audit_index', 'artifact_index')).toEqual(artifact);
    expect(repository.listBrowserAuditArtifacts('audit_index')).toEqual([artifact]);
    expect(repository.listBrowserAuditArtifactStorageKeys())
      .toEqual(['audit_index/artifact_index']);
    for (let index = 1; index < 50; index += 1) {
      expect(repository.saveBrowserAuditArtifact({
        ...artifact,
        id: `artifact_index_${index}`,
        storageKey: `audit_index/artifact_index_${index}`
      })).toBe(true);
    }
    expect(repository.saveBrowserAuditArtifact({
      ...artifact,
      id: 'artifact_index_overflow',
      storageKey: 'audit_index/artifact_index_overflow'
    })).toBe(false);
    expect(repository.listBrowserAuditArtifacts('audit_index')).toHaveLength(50);
    repository.close();

    const database = new Database(databasePath, { readonly: true });
    const columns = database
      .query<{ name: string; type: string }, []>('PRAGMA table_info(browser_audit_artifacts)')
      .all();
    expect(columns.map((column) => column.name)).not.toContain('payload');
    expect(columns.map((column) => column.type.toUpperCase())).not.toContain('BLOB');
    database.close();
  });

  test('removes expired indexes and files as one retention reconciliation flow', async () => {
    const directory = createTempDirectory();
    const databasePath = join(directory, 'webperf.sqlite');
    const repository = createSqliteJobRepository({
      databasePath,
      encryptionSecret: 'artifact-retention-encryption-secret'
    });
    repository.close();

    const store = new LocalBrowserAuditArtifactStore(join(directory, 'artifacts'));
    const body = new TextEncoder().encode('expired artifact');
    const stored = await store.write({
      auditId: 'audit_expired',
      artifactId: 'artifact_expired',
      body: new Response(body).body,
      expectedBytes: body.byteLength,
      maxBytes: 1_024
    });
    const database = new Database(databasePath);
    database.query(`
      INSERT INTO saved_entities (kind, id, created_at, updated_at, payload_json)
      VALUES ('browser_audit', 'audit_expired', ?, ?, 'encrypted-placeholder')
    `).run('2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z');
    database.query(`
      INSERT INTO browser_audit_artifacts (
        id, audit_id, registry_version, kind, filename, content_type,
        byte_size, sha256, storage_key, created_at
      ) VALUES (?, ?, 'v1', 'lighthouse-json', 'expired.json',
        'application/json', ?, ?, ?, ?)
    `).run(
      'artifact_expired',
      'audit_expired',
      stored.byteSize,
      stored.sha256,
      stored.storageKey,
      '2026-05-01T00:00:00.000Z'
    );

    expect(cleanupSqliteRetention(
      database,
      30,
      new Date('2026-07-22T00:00:00.000Z')
    )).toMatchObject({ derivedResources: 1, artifactIndexes: 1 });
    const validStorageKeys = database
      .query<{ storage_key: string }, []>(
        'SELECT storage_key FROM browser_audit_artifacts'
      )
      .all()
      .map((row) => row.storage_key);
    database.close();

    expect(await store.reconcile(new Set(validStorageKeys)))
      .toMatchObject({ removedFiles: 1, removedDirectories: 1 });
    await expect(store.openDownload(stored.storageKey, stored.byteSize))
      .rejects.toThrow();
  });

  test('does not surface malformed artifact index identifiers or metadata', () => {
    const databasePath = join(createTempDirectory(), 'webperf.sqlite');
    createSqliteJobRepository({
      databasePath,
      encryptionSecret: 'artifact-corruption-encryption-secret'
    }).close();
    const database = new Database(databasePath);
    database.query(`
      INSERT INTO browser_audit_artifacts (
        id, audit_id, registry_version, kind, filename, content_type,
        byte_size, sha256, storage_key, created_at
      ) VALUES ('bad/id', 'audit_corrupt', 'v1', 'lighthouse-json', ?,
        'application/json', 1, ?, 'audit_corrupt/bad/id', ?)
    `).run(
      'x'.repeat(256),
      'a'.repeat(64),
      '2026-07-22T00:00:00.000Z'
    );
    database.close();

    const repository = createSqliteJobRepository({
      databasePath,
      encryptionSecret: 'artifact-corruption-encryption-secret'
    });
    expect(repository.getBrowserAuditArtifact('audit_corrupt', 'bad/id')).toBeNull();
    expect(repository.listBrowserAuditArtifacts('audit_corrupt')).toEqual([]);
    repository.close();
  });
});
