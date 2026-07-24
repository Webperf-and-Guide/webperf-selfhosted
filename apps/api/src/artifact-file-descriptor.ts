import {
  link,
  open,
  readdir,
  rm,
  rmdir,
  type FileHandle
} from 'node:fs/promises';
import {
  linkDarwinDirectoryEntries,
  openDarwinDirectoryEntry,
  readDarwinDirectoryEntries,
  removeDarwinDirectoryEntry,
  unlinkDarwinDirectoryEntry
} from './artifact-file-descriptor-darwin';

type DirectoryDescriptor = { readonly fd: number };

export type ArtifactDirectoryEntry = {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
};

export type ArtifactFileHandle = {
  readonly fd: number;
  write(
    buffer: Uint8Array,
    offset: number,
    length: number
  ): Promise<{ bytesWritten: number }>;
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null
  ): Promise<{ bytesRead: number }>;
  stat(): ReturnType<FileHandle['stat']>;
  sync(): Promise<void>;
  chmod(mode: number): Promise<void>;
  close(): Promise<void>;
};

export const openPinnedDirectoryEntry = async (
  directoryHandle: DirectoryDescriptor,
  entryName: string,
  flags: number,
  mode = 0o600
): Promise<ArtifactFileHandle> => {
  assertDirectoryEntryName(entryName);

  if (process.platform === 'linux') {
    const handle = await open(
      linuxDirectoryEntryPath(directoryHandle, entryName),
      flags,
      mode
    );
    return {
      fd: handle.fd,
      write: async (buffer, offset, length) => {
        const result = await handle.write(buffer, offset, length, null);
        return { bytesWritten: result.bytesWritten };
      },
      read: async (buffer, offset, length, position) => {
        const result = await handle.read(buffer, offset, length, position);
        return { bytesRead: result.bytesRead };
      },
      stat: () => handle.stat(),
      sync: () => handle.sync(),
      chmod: (nextMode) => handle.chmod(nextMode),
      close: () => handle.close()
    };
  }

  assertDarwin('access');
  return openDarwinDirectoryEntry(directoryHandle.fd, entryName, flags, mode);
};

export const linkPinnedDirectoryEntries = async (
  directoryHandle: DirectoryDescriptor,
  sourceName: string,
  destinationName: string
) => {
  assertDirectoryEntryName(sourceName);
  assertDirectoryEntryName(destinationName);

  if (process.platform === 'linux') {
    await link(
      linuxDirectoryEntryPath(directoryHandle, sourceName),
      linuxDirectoryEntryPath(directoryHandle, destinationName)
    );
    return;
  }

  assertDarwin('publication');
  linkDarwinDirectoryEntries(directoryHandle.fd, sourceName, destinationName);
};

export const unlinkPinnedDirectoryEntry = async (
  directoryHandle: DirectoryDescriptor,
  entryName: string
) => {
  assertDirectoryEntryName(entryName);

  if (process.platform === 'linux') {
    await rm(linuxDirectoryEntryPath(directoryHandle, entryName), { force: true });
    return;
  }

  assertDarwin('deletion');
  unlinkDarwinDirectoryEntry(directoryHandle.fd, entryName);
};

export const removePinnedDirectoryEntry = async (
  directoryHandle: DirectoryDescriptor,
  entryName: string
) => {
  assertDirectoryEntryName(entryName);

  if (process.platform === 'linux') {
    await rmdir(linuxDirectoryEntryPath(directoryHandle, entryName));
    return;
  }

  assertDarwin('directory deletion');
  removeDarwinDirectoryEntry(directoryHandle.fd, entryName);
};

export const readPinnedDirectoryEntries = async (
  directoryHandle: DirectoryDescriptor
): Promise<ArtifactDirectoryEntry[]> => {
  if (process.platform === 'linux') {
    return readdir(linuxDirectoryPath(directoryHandle), { withFileTypes: true });
  }

  assertDarwin('directory enumeration');
  return readDarwinDirectoryEntries(directoryHandle.fd);
};

const linuxDirectoryEntryPath = (
  directoryHandle: DirectoryDescriptor,
  entryName: string
) => `/proc/self/fd/${directoryHandle.fd}/${entryName}`;

const linuxDirectoryPath = (directoryHandle: DirectoryDescriptor) =>
  `/proc/self/fd/${directoryHandle.fd}`;

const assertDirectoryEntryName = (entryName: string) => {
  if (
    entryName.length === 0
    || entryName === '.'
    || entryName === '..'
    || entryName.includes('/')
    || entryName.includes('\0')
  ) {
    throw new Error('Browser Audit artifact directory entry is invalid');
  }
};

const assertDarwin = (operation: string) => {
  if (process.platform !== 'darwin') {
    throw new Error(
      `Descriptor-relative Browser Audit artifact ${operation} is unsupported on ${process.platform}`
    );
  }
};
