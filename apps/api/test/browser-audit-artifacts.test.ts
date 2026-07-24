import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ArtifactStoreValidationError,
  LocalBrowserAuditArtifactStore,
  normalizeArtifactFilename
} from '../src/browser-audit-artifact-store';
import { openDarwinDirectoryEntry } from '../src/artifact-file-descriptor-darwin';
import {
  openPinnedDirectoryEntry,
  readPinnedDirectoryEntries,
  unlinkPinnedDirectoryEntry
} from '../src/artifact-file-descriptor';
import {
  issueBrowserAuditUploadToken,
  verifyBrowserAuditUploadToken
} from '../src/browser-audit-upload-token';
import {
  createSqliteJobRepository,
  isBrowserAuditArtifactLimitConstraint
} from '../src/repository';
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
    const [encodedClaims, signature] = token.split('.') as [string, string];
    const tamperedSignature = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;
    expect(verifyBrowserAuditUploadToken({
      // Change a full six-bit Base64 unit; mutating the final character can
      // alter only ignored padding bits and decode to the original signature.
      token: `${encodedClaims}.${tamperedSignature}`,
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
  test('rejects raw Darwin descriptor operations after close', async () => {
    if (process.platform !== 'darwin') {
      return;
    }

    const directory = createTempDirectory();
    const directoryHandle = await open(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    );
    const fileHandle = openDarwinDirectoryEntry(
      directoryHandle.fd,
      'artifact_closed_handle',
      constants.O_WRONLY
        | constants.O_CREAT
        | constants.O_EXCL
        | constants.O_NOFOLLOW,
      0o600
    );

    try {
      await fileHandle.close();
      await expect(fileHandle.write(Buffer.from('x'), 0, 1)).rejects.toThrow('closed');
      await expect(fileHandle.read(Buffer.alloc(1), 0, 1, null)).rejects.toThrow('closed');
      await expect(fileHandle.stat()).rejects.toThrow('closed');
      await expect(fileHandle.sync()).rejects.toThrow('closed');
      await expect(fileHandle.chmod(0o600)).rejects.toThrow('closed');
      await fileHandle.close();
    } finally {
      await fileHandle.close().catch(() => undefined);
      await directoryHandle.close();
    }
  });

  test('keeps directory enumeration and deletion pinned across path replacement', async () => {
    const directory = createTempDirectory();
    const root = join(directory, 'artifacts');
    const auditPath = join(root, 'audit_pinned_reconcile');
    const replacedPath = join(root, 'audit_replaced_reconcile');
    const outsidePath = join(directory, 'outside-reconcile');
    mkdirSync(auditPath, { recursive: true });
    mkdirSync(outsidePath);
    writeFileSync(join(auditPath, 'artifact_pinned'), 'pinned bytes');
    writeFileSync(join(outsidePath, 'artifact_pinned'), 'outside secret');
    const rootHandle = await open(
      root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    );
    const auditHandle = await openPinnedDirectoryEntry(
      rootHandle,
      'audit_pinned_reconcile',
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    );

    try {
      renameSync(auditPath, replacedPath);
      symlinkSync(outsidePath, auditPath);
      expect((await readPinnedDirectoryEntries(auditHandle)).map((entry) => entry.name))
        .toEqual(['artifact_pinned']);
      await unlinkPinnedDirectoryEntry(auditHandle, 'artifact_pinned');
    } finally {
      await auditHandle.close().catch(() => undefined);
      await rootHandle.close();
    }

    expect(existsSync(join(replacedPath, 'artifact_pinned'))).toBe(false);
    expect(readFileSync(join(outsidePath, 'artifact_pinned'), 'utf8'))
      .toBe('outside secret');
  });

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
    const reconciled = await store.reconcile(new Set([stored.storageKey]), {
      allowImmediateOrphanDeletion: true,
      minimumOrphanAgeMs: 0
    });
    expect(reconciled.removedFiles).toBe(1);
    expect(reconciled.removedDirectories).toBe(1);
    expect(await new Response(
      (await store.openDownload(stored.storageKey, body.byteLength)).body
    ).text()).toBe('{"score":0.91}');
  });

  test('rejects duplicate artifact publication without replacing the original bytes', async () => {
    const root = join(createTempDirectory(), 'artifacts');
    const store = new LocalBrowserAuditArtifactStore(root);
    const original = new TextEncoder().encode('original');
    const replacement = new TextEncoder().encode('replaced');
    const identity = {
      auditId: 'audit_duplicate',
      artifactId: 'artifact_duplicate',
      maxBytes: 1_024
    };

    const stored = await store.write({
      ...identity,
      body: new Response(original).body,
      expectedBytes: original.byteLength
    });
    await expect(store.write({
      ...identity,
      body: new Response(replacement).body,
      expectedBytes: replacement.byteLength
    })).rejects.toMatchObject({
      name: 'ArtifactStoreValidationError',
      status: 409
    });

    expect(await new Response(
      (await store.openDownload(stored.storageKey, original.byteLength)).body
    ).text()).toBe('original');
  });

  test('preserves fresh unindexed and temporary files until the reconciliation grace expires', async () => {
    const root = join(createTempDirectory(), 'artifacts');
    const auditPath = join(root, 'audit_fresh');
    mkdirSync(auditPath, { recursive: true });
    writeFileSync(join(auditPath, 'artifact_fresh'), 'fresh');
    writeFileSync(join(auditPath, 'artifact_pending.tmp-upload'), 'pending');
    const store = new LocalBrowserAuditArtifactStore(root);
    const startedAt = new Date();

    expect(await store.reconcile(new Set(), { now: startedAt })).toEqual({
      removedFiles: 0,
      removedDirectories: 0
    });
    expect(await Bun.file(join(auditPath, 'artifact_fresh')).exists()).toBe(true);
    expect(await Bun.file(join(auditPath, 'artifact_pending.tmp-upload')).exists()).toBe(true);

    expect(await store.reconcile(new Set(), {
      now: new Date(startedAt.getTime() + 60 * 60 * 1_000 + 1)
    })).toEqual({
      removedFiles: 2,
      removedDirectories: 1
    });
    expect(await Bun.file(join(auditPath, 'artifact_fresh')).exists()).toBe(false);
  });

  test('removes unexpected nested artifact directories relative to pinned handles', async () => {
    const root = join(createTempDirectory(), 'artifacts');
    const nestedPath = join(root, 'audit_nested', 'artifact_directory', 'nested');
    mkdirSync(nestedPath, { recursive: true });
    writeFileSync(join(nestedPath, 'payload'), 'orphan');
    const store = new LocalBrowserAuditArtifactStore(root);

    expect(await store.reconcile(new Set(), {
      allowImmediateOrphanDeletion: true,
      minimumOrphanAgeMs: 0
    })).toEqual({
      removedFiles: 0,
      removedDirectories: 2
    });
    expect(existsSync(join(root, 'audit_nested'))).toBe(false);
  });

  test('preserves unsupported artifact entry names without aborting reconciliation', async () => {
    const root = join(createTempDirectory(), 'artifacts');
    const auditPath = join(root, 'audit_unsupported_name');
    mkdirSync(auditPath, { recursive: true });
    writeFileSync(join(auditPath, 'unsupported\nname'), 'preserve');
    const store = new LocalBrowserAuditArtifactStore(root);

    expect(await store.reconcile(new Set(), {
      allowImmediateOrphanDeletion: true,
      minimumOrphanAgeMs: 0
    })).toEqual({
      removedFiles: 0,
      removedDirectories: 0
    });
    expect(readFileSync(join(auditPath, 'unsupported\nname'), 'utf8')).toBe('preserve');
  });

  test('requires explicit opt-in before deleting orphans without a grace period', async () => {
    const root = join(createTempDirectory(), 'artifacts');
    mkdirSync(join(root, 'audit_immediate'), { recursive: true });
    writeFileSync(join(root, 'audit_immediate', 'artifact_immediate'), 'fresh');
    const store = new LocalBrowserAuditArtifactStore(root);

    await expect(store.reconcile(new Set(), { minimumOrphanAgeMs: 0 }))
      .rejects.toThrow('explicit deletion opt-in');
    expect(await Bun.file(join(root, 'audit_immediate', 'artifact_immediate')).exists())
      .toBe(true);
  });

  test('rejects traversal, symlinks, declared-size mismatches, and byte-limit overflow', async () => {
    expect(() => normalizeArtifactFilename('../report.html'))
      .toThrow(ArtifactStoreValidationError);
    expect(() => normalizeArtifactFilename('....'))
      .toThrow(ArtifactStoreValidationError);
    expect(() => normalizeArtifactFilename('．．．'))
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

  test('streams from the validated descriptor even if the path is replaced', async () => {
    const directory = createTempDirectory();
    const root = join(directory, 'artifacts');
    const store = new LocalBrowserAuditArtifactStore(root);
    const body = new TextEncoder().encode('validated artifact');
    const stored = await store.write({
      auditId: 'audit_descriptor',
      artifactId: 'artifact_descriptor',
      body: new Response(body).body,
      expectedBytes: body.byteLength,
      maxBytes: 1_024
    });
    const download = await store.openDownload(stored.storageKey, body.byteLength);
    const artifactPath = join(root, 'audit_descriptor', 'artifact_descriptor');
    const outsidePath = join(directory, 'outside-secret');
    writeFileSync(outsidePath, 'must not be served');
    rmSync(artifactPath);
    symlinkSync(outsidePath, artifactPath);

    expect(await new Response(download.body).text()).toBe('validated artifact');
    expect(readFileSync(artifactPath, 'utf8')).toBe('must not be served');
    await expect(store.openDownload(stored.storageKey, body.byteLength))
      .rejects.toThrow('missing or inconsistent');
  });

  test('rejects artifact files with group or other permissions', async () => {
    const root = join(createTempDirectory(), 'artifacts');
    const store = new LocalBrowserAuditArtifactStore(root);
    const body = new TextEncoder().encode('private artifact');
    const stored = await store.write({
      auditId: 'audit_private_mode',
      artifactId: 'artifact_private_mode',
      body: new Response(body).body,
      expectedBytes: body.byteLength,
      maxBytes: 1_024
    });
    chmodSync(join(root, 'audit_private_mode', 'artifact_private_mode'), 0o640);

    await expect(store.openDownload(stored.storageKey, body.byteLength))
      .rejects.toThrow('missing or inconsistent');
  });

  test('keeps the validated audit directory pinned for the download stream', async () => {
    const directory = createTempDirectory();
    const root = join(directory, 'artifacts');
    const store = new LocalBrowserAuditArtifactStore(root);
    const body = new TextEncoder().encode('pinned audit directory');
    const stored = await store.write({
      auditId: 'audit_directory_descriptor',
      artifactId: 'artifact_directory_descriptor',
      body: new Response(body).body,
      expectedBytes: body.byteLength,
      maxBytes: 1_024
    });
    const download = await store.openDownload(stored.storageKey, body.byteLength);
    const auditPath = join(root, 'audit_directory_descriptor');
    const replacedPath = join(root, 'audit_directory_replaced');
    const outsidePath = join(directory, 'outside');
    mkdirSync(outsidePath);
    writeFileSync(join(outsidePath, 'artifact_directory_descriptor'), 'outside secret');
    renameSync(auditPath, replacedPath);
    symlinkSync(outsidePath, auditPath);

    expect(await new Response(download.body).text()).toBe('pinned audit directory');
    expect(readFileSync(join(auditPath, 'artifact_directory_descriptor'), 'utf8'))
      .toBe('outside secret');
  });

  test('publishes relative to the pinned directory and rejects a write-time swap', async () => {
    const directory = createTempDirectory();
    const root = join(directory, 'artifacts');
    const store = new LocalBrowserAuditArtifactStore(root);
    const body = new TextEncoder().encode('pinned write directory');
    let releaseStream = () => {};
    const streamRelease = new Promise<void>((resolveRelease) => {
      releaseStream = resolveRelease;
    });
    let markStreamStarted = () => {};
    const streamStarted = new Promise<void>((resolveStarted) => {
      markStreamStarted = resolveStarted;
    });
    const stream = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          controller.enqueue(body);
          markStreamStarted();
          await streamRelease;
          controller.close();
        }
      },
      { highWaterMark: 0 }
    );
    const write = store.write({
      auditId: 'audit_write_descriptor',
      artifactId: 'artifact_write_descriptor',
      body: stream,
      expectedBytes: body.byteLength,
      maxBytes: 1_024
    });

    await streamStarted;
    const auditPath = join(root, 'audit_write_descriptor');
    const replacedPath = join(root, 'audit_write_replaced');
    const outsidePath = join(directory, 'outside-write');
    renameSync(auditPath, replacedPath);
    mkdirSync(outsidePath);
    symlinkSync(outsidePath, auditPath);
    releaseStream();

    await expect(write).rejects.toThrow('changed during write');
    expect(await Bun.file(join(outsidePath, 'artifact_write_descriptor')).exists()).toBe(false);
    expect(await Bun.file(join(replacedPath, 'artifact_write_descriptor')).exists()).toBe(false);
  });

  test('rejects an intermediate audit-directory symlink during download and delete', async () => {
    const directory = createTempDirectory();
    const root = join(directory, 'artifacts');
    const store = new LocalBrowserAuditArtifactStore(root);
    const body = new TextEncoder().encode('indexed artifact');
    const stored = await store.write({
      auditId: 'audit_intermediate',
      artifactId: 'artifact_intermediate',
      body: new Response(body).body,
      expectedBytes: body.byteLength,
      maxBytes: 1_024
    });
    const auditPath = join(root, 'audit_intermediate');
    const outsidePath = join(directory, 'outside');
    mkdirSync(outsidePath);
    writeFileSync(join(outsidePath, 'artifact_intermediate'), 'outside secret');
    rmSync(auditPath, { recursive: true });
    symlinkSync(outsidePath, auditPath);

    await expect(store.openDownload(stored.storageKey, body.byteLength))
      .rejects.toThrow('unsafe');
    await expect(store.delete(stored.storageKey)).rejects.toThrow('unsafe');
    expect(readFileSync(join(outsidePath, 'artifact_intermediate'), 'utf8'))
      .toBe('outside secret');
  });

  test('deletes artifacts relative to the validated audit directory', async () => {
    const root = join(createTempDirectory(), 'artifacts');
    const store = new LocalBrowserAuditArtifactStore(root);
    const body = new TextEncoder().encode('delete by descriptor');
    const stored = await store.write({
      auditId: 'audit_delete_descriptor',
      artifactId: 'artifact_delete_descriptor',
      body: new Response(body).body,
      expectedBytes: body.byteLength,
      maxBytes: 1_024
    });

    await store.delete(stored.storageKey);
    await store.delete(stored.storageKey);
    await expect(store.openDownload(stored.storageKey, body.byteLength))
      .rejects.toThrow('missing or inconsistent');
  });

  test('normalizes a missing audit directory as an unavailable artifact', async () => {
    const root = join(createTempDirectory(), 'artifacts');
    const store = new LocalBrowserAuditArtifactStore(root);

    await expect(store.openDownload('audit_missing/artifact_missing', 1))
      .rejects.toThrow('Browser Audit artifact file is missing or inconsistent');
  });

  test('preserves root entries outside the managed artifact-ID namespace', async () => {
    const root = join(createTempDirectory(), 'artifacts');
    const outside = createTempDirectory();
    mkdirSync(join(root, 'lost+found'), { recursive: true });
    writeFileSync(join(outside, 'outside-marker'), 'preserve');
    writeFileSync(join(root, 'lost+found', 'filesystem-marker'), 'preserve');
    writeFileSync(join(root, '.gitkeep'), 'preserve');
    writeFileSync(join(root, 'managed_conflict'), 'remove');
    symlinkSync(outside, join(root, 'audit_link'));
    const store = new LocalBrowserAuditArtifactStore(root);

    expect(await store.reconcile(new Set(), {
      allowImmediateOrphanDeletion: true,
      minimumOrphanAgeMs: 0
    })).toEqual({
      removedFiles: 2,
      removedDirectories: 0
    });
    expect(readFileSync(join(root, 'lost+found', 'filesystem-marker'), 'utf8'))
      .toBe('preserve');
    expect(readFileSync(join(root, '.gitkeep'), 'utf8')).toBe('preserve');
    expect(await Bun.file(join(root, 'managed_conflict')).exists()).toBe(false);
    expect(existsSync(join(root, 'audit_link'))).toBe(false);
    expect(readFileSync(join(outside, 'outside-marker'), 'utf8')).toBe('preserve');
  });
});

describe('Browser Audit artifact indexes', () => {
  test('classifies only the named SQLite artifact-limit constraint', () => {
    expect(isBrowserAuditArtifactLimitConstraint({
      code: 'SQLITE_CONSTRAINT_TRIGGER',
      message: 'browser_audit_artifact_limit'
    })).toBe(true);
    expect(isBrowserAuditArtifactLimitConstraint({
      code: 'SQLITE_CONSTRAINT',
      message: 'constraint failed: browser_audit_artifact_limit'
    })).toBe(true);
    expect(isBrowserAuditArtifactLimitConstraint({
      code: 'SQLITE_CONSTRAINT_TRIGGER',
      message: 'unrelated_trigger_limit'
    })).toBe(false);
    expect(isBrowserAuditArtifactLimitConstraint({
      code: 'EOTHER',
      message: 'browser_audit_artifact_limit'
    })).toBe(false);
    expect(isBrowserAuditArtifactLimitConstraint(null)).toBe(false);
  });

  test('rejects a persisted artifact-limit trigger that drifts from the contract', () => {
    const databasePath = join(createTempDirectory(), 'webperf.sqlite');
    createSqliteJobRepository({
      databasePath,
      encryptionSecret: 'artifact-trigger-encryption-secret'
    }).close();
    const database = new Database(databasePath);
    database.exec(`
      DROP TRIGGER browser_audit_artifacts_limit_before_insert;
      CREATE TRIGGER browser_audit_artifacts_limit_before_insert
      BEFORE INSERT ON browser_audit_artifacts
      WHEN (
        SELECT COUNT(*)
        FROM browser_audit_artifacts
        WHERE audit_id = NEW.audit_id
      ) >= 49
      BEGIN
        SELECT RAISE(ABORT, 'browser_audit_artifact_limit');
      END;
    `);
    database.close();

    expect(() => createSqliteJobRepository({
      databasePath,
      encryptionSecret: 'artifact-trigger-encryption-secret'
    })).toThrow('must enforce exactly 50 artifacts per audit');
    const reopened = new Database(databasePath);
    reopened.close();
  });

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

  test('rejects invalid artifact metadata before writing an index row', () => {
    const repository = createSqliteJobRepository({
      databasePath: join(createTempDirectory(), 'webperf.sqlite'),
      encryptionSecret: 'artifact-validation-encryption-secret'
    });
    const artifact = {
      id: 'artifact_invalid',
      auditId: 'audit_invalid',
      registryVersion: 'v1' as const,
      kind: 'lighthouse-json',
      filename: 'report.json',
      contentType: 'application/json',
      byteSize: 128,
      sha256: 'a'.repeat(64),
      storageKey: 'audit_invalid/artifact_invalid',
      createdAt: '2026-07-22T00:00:00.000Z'
    };

    for (const invalidArtifact of [
      { ...artifact, storageKey: '../artifact_invalid' },
      { ...artifact, sha256: 'not-a-sha256-digest' },
      { ...artifact, contentType: 'text/html' },
      { ...artifact, createdAt: 'not-a-timestamp' }
    ]) {
      expect(() => repository.saveBrowserAuditArtifact(invalidArtifact)).toThrow(
        'Browser Audit artifact metadata is invalid'
      );
    }

    expect(repository.listBrowserAuditArtifacts('audit_invalid')).toEqual([]);
    expect(repository.listBrowserAuditArtifactStorageKeys()).toEqual([]);
    repository.close();
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

    expect(await store.reconcile(new Set(validStorageKeys), {
      allowImmediateOrphanDeletion: true,
      minimumOrphanAgeMs: 0
    }))
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
    database.query(`
      INSERT INTO browser_audit_artifacts (
        id, audit_id, registry_version, kind, filename, content_type,
        byte_size, sha256, storage_key, created_at
      ) VALUES ('artifact_kind_too_long', 'audit_corrupt', 'v1', ?,
        'report.json', 'application/json', 1, ?,
        'audit_corrupt/artifact_kind_too_long', ?)
    `).run(
      `a${'b'.repeat(120)}`,
      'b'.repeat(64),
      '2026-07-22T00:00:00.000Z'
    );
    database.close();

    const repository = createSqliteJobRepository({
      databasePath,
      encryptionSecret: 'artifact-corruption-encryption-secret'
    });
    expect(repository.getBrowserAuditArtifact('audit_corrupt', 'bad/id')).toBeNull();
    expect(
      repository.getBrowserAuditArtifact('audit_corrupt', 'artifact_kind_too_long')
    ).toBeNull();
    expect(repository.listBrowserAuditArtifacts('audit_corrupt')).toEqual([]);
    repository.close();
  });
});
