import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readdir,
  rm,
  rmdir
} from 'node:fs/promises';
import { parse, resolve, sep } from 'node:path';
import {
  linkPinnedDirectoryEntries,
  openPinnedDirectoryEntry,
  unlinkPinnedDirectoryEntry,
  type ArtifactFileHandle
} from './artifact-file-descriptor';

const safeStorageSegment = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;

export type StoredArtifactFile = {
  storageKey: string;
  byteSize: number;
  sha256: string;
};

export type ArtifactReconciliationResult = {
  removedFiles: number;
  removedDirectories: number;
};
export const artifactReconciliationGraceMs = 60 * 60 * 1_000;
export type ArtifactReconciliationOptions = {
  allowImmediateOrphanDeletion?: boolean;
  minimumOrphanAgeMs?: number;
  now?: Date;
};

export interface BrowserAuditArtifactStore {
  write(input: {
    auditId: string;
    artifactId: string;
    body: ReadableStream<Uint8Array> | null;
    expectedBytes: number;
    maxBytes: number;
  }): Promise<StoredArtifactFile>;
  openDownload(storageKey: string, expectedBytes: number): Promise<{
    body: ReadableStream<Uint8Array>;
    byteSize: number;
  }>;
  delete(storageKey: string): Promise<void>;
  reconcile(
    validStorageKeys: ReadonlySet<string>,
    options?: ArtifactReconciliationOptions
  ): Promise<ArtifactReconciliationResult>;
}

export class ArtifactStoreValidationError extends Error {
  override readonly name = 'ArtifactStoreValidationError';

  constructor(
    message: string,
    readonly status: 400 | 409 | 413 = 400
  ) {
    super(message);
  }
}

export const normalizeArtifactFilename = (value: string) => {
  const normalized = value.normalize('NFKC').trim();

  if (
    normalized.length === 0
    || normalized.length > 255
    || normalized === '.'
    || normalized === '..'
    || normalized.includes('/')
    || normalized.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new ArtifactStoreValidationError('Artifact filename is invalid');
  }

  const safe = normalized
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_+/g, '_');

  if (!safe || /^\.+$/.test(safe)) {
    throw new ArtifactStoreValidationError('Artifact filename is invalid');
  }

  return safe;
};

export class LocalBrowserAuditArtifactStore implements BrowserAuditArtifactStore {
  readonly rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = resolve(rootPath);

    if (this.rootPath === parse(this.rootPath).root) {
      throw new Error('Browser Audit artifact root must not be a filesystem root');
    }
  }

  async write({
    auditId,
    artifactId,
    body,
    expectedBytes,
    maxBytes
  }: {
    auditId: string;
    artifactId: string;
    body: ReadableStream<Uint8Array> | null;
    expectedBytes: number;
    maxBytes: number;
  }): Promise<StoredArtifactFile> {
    assertStorageSegment(auditId, 'audit ID');
    assertStorageSegment(artifactId, 'artifact ID');

    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) {
      throw new ArtifactStoreValidationError('Artifact size is invalid');
    }

    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new Error('Artifact byte limit must be a positive integer');
    }

    if (expectedBytes > maxBytes) {
      throw new ArtifactStoreValidationError('Artifact exceeds the configured byte limit', 413);
    }

    await this.ensureRoot();
    const auditPath = this.pathForAudit(auditId);
    await mkdir(auditPath, { recursive: false, mode: 0o700 }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    });
    const storageKey = `${auditId}/${artifactId}`;
    const temporaryEntry = `${artifactId}.tmp-${randomUUID()}`;
    const auditDirectory = await openPrivateDirectory(
      auditPath,
      'Browser Audit artifact directory is unsafe'
    );
    const hash = createHash('sha256');
    let byteSize = 0;
    let handle: ArtifactFileHandle | undefined;
    let temporaryRemoved = false;
    let destinationPublished = false;
    let completed = false;
    let closed = false;

    try {
      handle = await openPinnedDirectoryEntry(
        auditDirectory,
        temporaryEntry,
        constants.O_WRONLY
          | constants.O_CREAT
          | constants.O_EXCL
          | constants.O_NOFOLLOW,
        0o600
      );
      const reader = body?.getReader();

      if (reader) {
        while (true) {
          const chunk = await reader.read();

          if (chunk.done) {
            break;
          }

          byteSize += chunk.value.byteLength;
          if (byteSize > maxBytes || byteSize > expectedBytes) {
            await reader.cancel();
            throw new ArtifactStoreValidationError('Artifact exceeds the declared byte size', 413);
          }

          hash.update(chunk.value);
          let written = 0;
          while (written < chunk.value.byteLength) {
            const result = await handle.write(
              chunk.value,
              written,
              chunk.value.byteLength - written
            );

            if (result.bytesWritten < 1) {
              throw new Error('Artifact file write made no progress');
            }

            written += result.bytesWritten;
          }
        }
      }

      if (byteSize !== expectedBytes) {
        throw new ArtifactStoreValidationError('Artifact body does not match its declared byte size');
      }

      await handle.sync();
      await handle.chmod(0o600);
      await handle.close();
      closed = true;
      try {
        await linkPinnedDirectoryEntries(auditDirectory, temporaryEntry, artifactId);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new ArtifactStoreValidationError('Artifact already exists', 409);
        }
        throw error;
      }
      destinationPublished = true;
      try {
        await unlinkPinnedDirectoryEntry(auditDirectory, temporaryEntry);
        temporaryRemoved = true;
      } catch {
        // Publication already owns the completed bytes. Keep it valid and let
        // retention reconciliation retry removal of the orphaned temporary link.
      }
      await assertPinnedDirectory(
        auditPath,
        auditDirectory,
        'Browser Audit artifact directory changed during write'
      );
      completed = true;

      return {
        storageKey,
        byteSize,
        sha256: hash.digest('hex')
      };
    } finally {
      if (handle && !closed) {
        await handle.close().catch(() => undefined);
      }
      if (!temporaryRemoved) {
        await unlinkPinnedDirectoryEntry(auditDirectory, temporaryEntry).catch(() => undefined);
      }
      if (destinationPublished && !completed) {
        await unlinkPinnedDirectoryEntry(auditDirectory, artifactId).catch(() => undefined);
      }
      await auditDirectory.close().catch(() => undefined);
    }
  }

  async openDownload(storageKey: string, expectedBytes: number) {
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) {
      throw new ArtifactStoreValidationError('Artifact size is invalid');
    }
    await this.ensureRoot();
    const { auditId, artifactId } = this.locationForStorageKey(storageKey);
    const auditPath = this.pathForAudit(auditId);
    let handle: ArtifactFileHandle | undefined;
    let auditDirectory: Awaited<ReturnType<typeof open>> | undefined;

    try {
      auditDirectory = await openPrivateDirectory(
        auditPath,
        'Browser Audit artifact directory is unsafe'
      );
      handle = await openPinnedDirectoryEntry(
        auditDirectory,
        artifactId,
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
      const file = await handle.stat();

      if (!file.isFile() || file.size !== expectedBytes) {
        throw new Error('Browser Audit artifact file is missing or inconsistent');
      }
      await assertPinnedDirectory(
        auditPath,
        auditDirectory,
        'Browser Audit artifact directory changed during download'
      );

      const body = readableFileHandle(handle, file.size, [auditDirectory]);
      auditDirectory = undefined;
      return {
        body,
        byteSize: file.size
      };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await auditDirectory?.close().catch(() => undefined);
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ELOOP' || code === 'ENOENT' || code === 'ENOTDIR') {
        throw new Error(
          'Browser Audit artifact file is missing or inconsistent',
          { cause: error }
        );
      }
      throw error;
    }
  }

  async delete(storageKey: string) {
    await this.ensureRoot();
    const { auditId, artifactId } = this.locationForStorageKey(storageKey);
    const auditPath = this.pathForAudit(auditId);
    const auditDirectory = await openPrivateDirectory(
      auditPath,
      'Browser Audit artifact directory is unsafe'
    ).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    });
    if (!auditDirectory) {
      return;
    }
    try {
      await assertPinnedDirectory(
        auditPath,
        auditDirectory,
        'Browser Audit artifact directory changed before delete'
      );
      await unlinkPinnedDirectoryEntry(auditDirectory, artifactId);
      await assertPinnedDirectory(
        auditPath,
        auditDirectory,
        'Browser Audit artifact directory changed during delete'
      );
    } finally {
      await auditDirectory.close().catch(() => undefined);
    }
  }

  async reconcile(
    validStorageKeys: ReadonlySet<string>,
    options: ArtifactReconciliationOptions = {}
  ): Promise<ArtifactReconciliationResult> {
    const minimumOrphanAgeMs = options.minimumOrphanAgeMs ?? artifactReconciliationGraceMs;
    if (!Number.isSafeInteger(minimumOrphanAgeMs) || minimumOrphanAgeMs < 0) {
      throw new Error('Artifact reconciliation grace must be a non-negative integer');
    }
    if (
      minimumOrphanAgeMs === 0
      && options.allowImmediateOrphanDeletion !== true
    ) {
      throw new Error(
        'Immediate artifact reconciliation requires explicit deletion opt-in'
      );
    }
    const now = options.now ?? new Date();
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) {
      throw new Error('Artifact reconciliation time must be valid');
    }
    const orphanCutoffMs = nowMs - minimumOrphanAgeMs;
    await this.ensureRoot();
    // Validate every caller-provided key before any reconciliation deletion.
    for (const key of validStorageKeys) {
      this.pathForStorageKey(key);
    }
    const valid = new Set(validStorageKeys);
    let removedFiles = 0;
    let removedDirectories = 0;

    for (const auditEntry of await readdir(this.rootPath, { withFileTypes: true })) {
      const auditPath = resolve(this.rootPath, auditEntry.name);

      // The store owns only ID-shaped root names. Preserve filesystem and
      // deployment entries such as lost+found or .gitkeep.
      if (!safeStorageSegment.test(auditEntry.name)) {
        continue;
      }

      if (!auditEntry.isDirectory() || auditEntry.isSymbolicLink()) {
        await rm(auditPath, { recursive: true, force: true });
        if (auditEntry.isDirectory()) {
          removedDirectories += 1;
        } else {
          removedFiles += 1;
        }
        continue;
      }

      let directoryMtimeMs: number;
      try {
        const directory = await lstat(auditPath);
        if (!directory.isDirectory() || directory.isSymbolicLink()) {
          await rm(auditPath, { recursive: true, force: true });
          removedDirectories += 1;
          continue;
        }
        directoryMtimeMs = directory.mtimeMs;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          continue;
        }
        throw error;
      }

      for (const artifactEntry of await readdir(auditPath, { withFileTypes: true })) {
        const artifactPath = resolve(auditPath, artifactEntry.name);
        const storageKey = `${auditEntry.name}/${artifactEntry.name}`;

        const safeRegularFile = artifactEntry.isFile() && !artifactEntry.isSymbolicLink();
        const indexedFile = safeRegularFile
          && safeStorageSegment.test(artifactEntry.name)
          && valid.has(storageKey);

        if (indexedFile) {
          continue;
        }

        if (safeRegularFile && minimumOrphanAgeMs > 0) {
          let file;
          try {
            file = await lstat(artifactPath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
              continue;
            }
            throw error;
          }
          if (file.isFile() && !file.isSymbolicLink() && file.mtimeMs > orphanCutoffMs) {
            continue;
          }
        }

        await rm(artifactPath, { recursive: true, force: true });
        removedFiles += 1;
      }

      let remainingEntries;
      try {
        remainingEntries = await readdir(auditPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          continue;
        }
        throw error;
      }

      if (remainingEntries.length === 0) {
        if (minimumOrphanAgeMs === 0 || directoryMtimeMs <= orphanCutoffMs) {
          try {
            await rmdir(auditPath);
            removedDirectories += 1;
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== 'ENOTEMPTY' && code !== 'ENOENT') {
              throw error;
            }
          }
        }
      }
    }

    return { removedFiles, removedDirectories };
  }

  private async ensureRoot() {
    await mkdir(this.rootPath, { recursive: true, mode: 0o700 });
    // Revalidate on every operation: this directory is writable external state and
    // can be replaced after process startup by a compromised local executor.
    await enforcePrivateDirectory(this.rootPath, 'Browser Audit artifact root is unsafe');
  }

  private pathForAudit(auditId: string) {
    assertStorageSegment(auditId, 'audit ID');
    const path = resolve(this.rootPath, auditId);
    assertDescendant(this.rootPath, path);
    return path;
  }

  private pathForStorageKey(storageKey: string) {
    return this.locationForStorageKey(storageKey).path;
  }

  private locationForStorageKey(storageKey: string) {
    const parts = storageKey.split('/');

    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new ArtifactStoreValidationError('Artifact storage key is invalid');
    }

    assertStorageSegment(parts[0], 'audit ID');
    assertStorageSegment(parts[1], 'artifact ID');
    const path = resolve(this.rootPath, parts[0], parts[1]);
    assertDescendant(this.rootPath, path);
    return {
      auditId: parts[0],
      artifactId: parts[1],
      path
    };
  }
}

const assertStorageSegment = (value: string, label: string) => {
  if (!safeStorageSegment.test(value)) {
    throw new ArtifactStoreValidationError(`Artifact ${label} is invalid`);
  }
};

const assertDescendant = (rootPath: string, candidatePath: string) => {
  if (!candidatePath.startsWith(`${rootPath}${sep}`)) {
    throw new ArtifactStoreValidationError('Artifact path escapes the configured root');
  }
};

const openDirectoryNoFollow = async (path: string, unsafeMessage: string) => {
  try {
    return await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ELOOP' || code === 'ENOTDIR') {
      throw new Error(unsafeMessage, { cause: error });
    }
    throw error;
  }
};

const openPrivateDirectory = async (path: string, unsafeMessage: string) => {
  const handle = await openDirectoryNoFollow(path, unsafeMessage);

  try {
    const directory = await handle.stat();

    if (!directory.isDirectory()) {
      throw new Error(unsafeMessage);
    }

    const effectiveUid = typeof process.geteuid === 'function'
      ? process.geteuid()
      : undefined;
    if (effectiveUid !== undefined && directory.uid !== effectiveUid) {
      throw new Error(
        `${unsafeMessage}: directory owner uid ${directory.uid} does not match process uid ${effectiveUid}`
      );
    }

    await handle.chmod(0o700);
    const securedDirectory = await handle.stat();
    if ((securedDirectory.mode & 0o077) !== 0) {
      throw new Error(unsafeMessage);
    }

    return handle;
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
};

const enforcePrivateDirectory = async (path: string, unsafeMessage: string) => {
  const handle = await openPrivateDirectory(path, unsafeMessage);
  await handle.close();
};

const assertPinnedDirectory = async (
  path: string,
  pinnedHandle: Awaited<ReturnType<typeof open>>,
  unsafeMessage: string
) => {
  const pinnedDirectory = await pinnedHandle.stat();
  let currentHandle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    currentHandle = await openDirectoryNoFollow(path, unsafeMessage);
    const currentDirectory = await currentHandle.stat();
    if (
      currentDirectory.dev !== pinnedDirectory.dev
      || currentDirectory.ino !== pinnedDirectory.ino
    ) {
      throw new Error(unsafeMessage);
    }
  } finally {
    await currentHandle?.close().catch(() => undefined);
  }
};

const readableFileHandle = (
  handle: ArtifactFileHandle,
  byteSize: number,
  pinnedDirectories: Array<Awaited<ReturnType<typeof open>>> = []
): ReadableStream<Uint8Array> => {
  let closed = false;
  let remainingBytes = byteSize;

  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    await handle.close().catch(() => undefined);
    await Promise.all(
      pinnedDirectories.map((directory) => directory.close().catch(() => undefined))
    );
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (remainingBytes === 0) {
          await close();
          controller.close();
          return;
        }

        const buffer = Buffer.allocUnsafe(Math.min(64 * 1_024, remainingBytes));
        const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);

        if (bytesRead === 0) {
          throw new Error('Browser Audit artifact file changed while streaming');
        }

        remainingBytes -= bytesRead;
        controller.enqueue(buffer.subarray(0, bytesRead));
      } catch (error) {
        await close();
        controller.error(error);
      }
    },
    async cancel() {
      await close();
    }
  });
};
