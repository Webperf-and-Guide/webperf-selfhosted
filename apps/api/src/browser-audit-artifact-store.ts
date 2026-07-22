import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  rm,
  rmdir
} from 'node:fs/promises';
import { parse, resolve, sep } from 'node:path';

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

export interface BrowserAuditArtifactStore {
  write(input: {
    auditId: string;
    artifactId: string;
    body: ReadableStream<Uint8Array> | null;
    expectedBytes: number;
    maxBytes: number;
  }): Promise<StoredArtifactFile>;
  openDownload(storageKey: string, expectedBytes: number): Promise<{
    body: BodyInit;
    byteSize: number;
  }>;
  delete(storageKey: string): Promise<void>;
  reconcile(validStorageKeys: ReadonlySet<string>): Promise<ArtifactReconciliationResult>;
}

export class ArtifactStoreValidationError extends Error {
  override readonly name = 'ArtifactStoreValidationError';

  constructor(
    message: string,
    readonly status: 400 | 413 = 400
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

  if (!safe || safe === '.' || safe === '..') {
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
    await mkdir(auditPath, { recursive: false, mode: 0o700 }).catch(async (error) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }

      const existing = await lstat(auditPath);
      if (!existing.isDirectory() || existing.isSymbolicLink()) {
        throw new Error('Browser Audit artifact directory is unsafe');
      }
    });
    await chmod(auditPath, 0o700);

    const storageKey = `${auditId}/${artifactId}`;
    const destinationPath = this.pathForStorageKey(storageKey);
    const temporaryPath = `${destinationPath}.tmp-${randomUUID()}`;
    const handle = await open(temporaryPath, 'wx', 0o600);
    const hash = createHash('sha256');
    let byteSize = 0;
    let published = false;

    try {
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
      await handle.close();
      await link(temporaryPath, destinationPath);
      published = true;
      await rm(temporaryPath, { force: true });
      await chmod(destinationPath, 0o600);

      return {
        storageKey,
        byteSize,
        sha256: hash.digest('hex')
      };
    } finally {
      await handle.close().catch(() => undefined);
      if (!published) {
        await rm(temporaryPath, { force: true });
      }
    }
  }

  async openDownload(storageKey: string, expectedBytes: number) {
    await this.ensureRoot();
    const path = this.pathForStorageKey(storageKey);
    const file = await lstat(path);

    if (!file.isFile() || file.isSymbolicLink() || file.size !== expectedBytes) {
      throw new Error('Browser Audit artifact file is missing or inconsistent');
    }

    return {
      body: Bun.file(path),
      byteSize: file.size
    };
  }

  async delete(storageKey: string) {
    const path = this.pathForStorageKey(storageKey);
    await rm(path, { force: true });
  }

  async reconcile(validStorageKeys: ReadonlySet<string>): Promise<ArtifactReconciliationResult> {
    await this.ensureRoot();
    const valid = new Set([...validStorageKeys].map((key) => {
      this.pathForStorageKey(key);
      return key;
    }));
    let removedFiles = 0;
    let removedDirectories = 0;

    for (const auditEntry of await readdir(this.rootPath, { withFileTypes: true })) {
      const auditPath = resolve(this.rootPath, auditEntry.name);

      if (!auditEntry.isDirectory() || auditEntry.isSymbolicLink() || !safeStorageSegment.test(auditEntry.name)) {
        await rm(auditPath, { recursive: true, force: true });
        removedFiles += 1;
        continue;
      }

      for (const artifactEntry of await readdir(auditPath, { withFileTypes: true })) {
        const artifactPath = resolve(auditPath, artifactEntry.name);
        const storageKey = `${auditEntry.name}/${artifactEntry.name}`;

        if (
          !artifactEntry.isFile()
          || artifactEntry.isSymbolicLink()
          || !safeStorageSegment.test(artifactEntry.name)
          || !valid.has(storageKey)
        ) {
          await rm(artifactPath, { recursive: true, force: true });
          removedFiles += 1;
        }
      }

      if ((await readdir(auditPath)).length === 0) {
        await rmdir(auditPath);
        removedDirectories += 1;
      }
    }

    return { removedFiles, removedDirectories };
  }

  private async ensureRoot() {
    await mkdir(this.rootPath, { recursive: true, mode: 0o700 });
    const root = await lstat(this.rootPath);

    if (!root.isDirectory() || root.isSymbolicLink()) {
      throw new Error('Browser Audit artifact root is unsafe');
    }

    await chmod(this.rootPath, 0o700);
  }

  private pathForAudit(auditId: string) {
    assertStorageSegment(auditId, 'audit ID');
    const path = resolve(this.rootPath, auditId);
    assertDescendant(this.rootPath, path);
    return path;
  }

  private pathForStorageKey(storageKey: string) {
    const parts = storageKey.split('/');

    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new ArtifactStoreValidationError('Artifact storage key is invalid');
    }

    assertStorageSegment(parts[0], 'audit ID');
    assertStorageSegment(parts[1], 'artifact ID');
    const path = resolve(this.rootPath, parts[0], parts[1]);
    assertDescendant(this.rootPath, path);
    return path;
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
