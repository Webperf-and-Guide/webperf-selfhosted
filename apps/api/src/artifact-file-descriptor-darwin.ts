import {
  close as closeFileDescriptor,
  fchmod,
  fstat,
  fsync,
  read as readFileDescriptor,
  write as writeFileDescriptor,
  type Stats
} from 'node:fs';
import { constants as osConstants } from 'node:os';
import { dlopen, FFIType, ptr, read as ffiRead, type Pointer } from 'bun:ffi';

export type DarwinArtifactFileHandle = {
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
  stat(): Promise<Stats>;
  sync(): Promise<void>;
  chmod(mode: number): Promise<void>;
  close(): Promise<void>;
};

export const openDarwinDirectoryEntry = (
  directoryFd: number,
  entryName: string,
  flags: number,
  mode: number
): DarwinArtifactFileHandle => {
  const binding = getDarwinDirectoryBinding();
  const name = Buffer.from(`${entryName}\0`);
  const descriptor = binding.openat(directoryFd, ptr(name), flags, mode);
  if (descriptor < 0) {
    throw createNativeFilesystemError(binding, 'openat', entryName);
  }
  return createRawArtifactFileHandle(descriptor);
};

export const linkDarwinDirectoryEntries = (
  directoryFd: number,
  sourceName: string,
  destinationName: string
) => {
  const binding = getDarwinDirectoryBinding();
  const source = Buffer.from(`${sourceName}\0`);
  const destination = Buffer.from(`${destinationName}\0`);
  const result = binding.linkat(
    directoryFd,
    ptr(source),
    directoryFd,
    ptr(destination),
    0
  );
  if (result !== 0) {
    throw createNativeFilesystemError(binding, 'linkat', destinationName);
  }
};

export const unlinkDarwinDirectoryEntry = (
  directoryFd: number,
  entryName: string
) => {
  const binding = getDarwinDirectoryBinding();
  const name = Buffer.from(`${entryName}\0`);
  const result = binding.unlinkat(directoryFd, ptr(name), 0);
  if (result !== 0) {
    const error = createNativeFilesystemError(binding, 'unlinkat', entryName);
    if (error.errno === osConstants.errno.ENOENT) {
      return;
    }
    throw error;
  }
};

const createRawArtifactFileHandle = (descriptor: number): DarwinArtifactFileHandle => {
  let state: 'open' | 'closing' | 'closed' = 'open';
  let closePromise: Promise<void> | null = null;
  const pendingOperations = new Set<Promise<unknown>>();

  const assertOpen = () => {
    if (state !== 'open') {
      throw new Error('Browser Audit artifact file handle is closed');
    }
  };

  const track = <Result>(operation: Promise<Result>) => {
    pendingOperations.add(operation);
    void operation.finally(() => pendingOperations.delete(operation)).catch(() => undefined);
    return operation;
  };

  return {
    fd: descriptor,
    write: (buffer, offset, length) => {
      assertOpen();
      return track(new Promise((resolveWrite, rejectWrite) => {
        writeFileDescriptor(
          descriptor,
          buffer,
          offset,
          length,
          null,
          (error, bytesWritten) => {
            if (error) {
              rejectWrite(error);
              return;
            }
            resolveWrite({ bytesWritten });
          }
        );
      }));
    },
    read: (buffer, offset, length, position) => {
      assertOpen();
      return track(new Promise((resolveRead, rejectRead) => {
        readFileDescriptor(
          descriptor,
          buffer,
          offset,
          length,
          position,
          (error, bytesRead) => {
            if (error) {
              rejectRead(error);
              return;
            }
            resolveRead({ bytesRead });
          }
        );
      }));
    },
    stat: () => {
      assertOpen();
      return track(new Promise((resolveStat, rejectStat) => {
        fstat(descriptor, (error, stats) => {
          if (error) {
            rejectStat(error);
            return;
          }
          resolveStat(stats);
        });
      }));
    },
    sync: () => {
      assertOpen();
      return track(new Promise((resolveSync, rejectSync) => {
        fsync(descriptor, (error) => {
          if (error) {
            rejectSync(error);
            return;
          }
          resolveSync();
        });
      }));
    },
    chmod: (mode) => {
      assertOpen();
      return track(new Promise((resolveChmod, rejectChmod) => {
        fchmod(descriptor, mode, (error) => {
          if (error) {
            rejectChmod(error);
            return;
          }
          resolveChmod();
        });
      }));
    },
    close: () => {
      if (state === 'closed') {
        return Promise.resolve();
      }
      if (closePromise) {
        return closePromise;
      }

      state = 'closing';
      closePromise = (async () => {
        await Promise.allSettled([...pendingOperations]);
        try {
          await new Promise<void>((resolveClose, rejectClose) => {
            closeFileDescriptor(descriptor, (error) => {
              if (error) {
                rejectClose(error);
                return;
              }
              resolveClose();
            });
          });
        } finally {
          // POSIX leaves descriptor state unspecified after a close error.
          // Retrying could close a newly reused fd, so fail closed permanently.
          state = 'closed';
        }
      })();
      return closePromise;
    }
  };
};

type DarwinDirectoryBinding = {
  openat: (
    directoryFd: number,
    path: Pointer,
    flags: number,
    mode: number
  ) => number;
  linkat: (
    sourceDirectoryFd: number,
    sourcePath: Pointer,
    destinationDirectoryFd: number,
    destinationPath: Pointer,
    flags: number
  ) => number;
  unlinkat: (directoryFd: number, path: Pointer, flags: number) => number;
  errno: () => Pointer | null;
};

let darwinDirectoryBinding: DarwinDirectoryBinding | undefined;

const getDarwinDirectoryBinding = () => {
  darwinDirectoryBinding ??= loadDarwinDirectoryBinding();
  return darwinDirectoryBinding;
};

const loadDarwinDirectoryBinding = (): DarwinDirectoryBinding => {
  const library = dlopen('/usr/lib/libSystem.B.dylib', {
    openat: {
      args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.u32],
      returns: FFIType.i32
    },
    linkat: {
      args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.i32],
      returns: FFIType.i32
    },
    unlinkat: {
      args: [FFIType.i32, FFIType.ptr, FFIType.i32],
      returns: FFIType.i32
    },
    __error: {
      args: [],
      returns: FFIType.ptr
    }
  });
  const symbols = library.symbols as unknown as {
    openat: DarwinDirectoryBinding['openat'];
    linkat: DarwinDirectoryBinding['linkat'];
    unlinkat: DarwinDirectoryBinding['unlinkat'];
    __error: DarwinDirectoryBinding['errno'];
  };

  return {
    openat: symbols.openat,
    linkat: symbols.linkat,
    unlinkat: symbols.unlinkat,
    errno: symbols.__error
  };
};

const createNativeFilesystemError = (
  binding: DarwinDirectoryBinding,
  syscall: 'openat' | 'linkat' | 'unlinkat',
  entryName: string
) => {
  // The POSIX calls above are synchronous; read thread-local errno before any
  // other native filesystem operation can overwrite it.
  const errnoPointer = binding.errno();
  const errno = errnoPointer === null ? null : ffiRead.i32(errnoPointer, 0);
  const code = errno === null
    ? 'UNKNOWN'
    : Object.entries(osConstants.errno)
      .find(([, value]) => value === errno)?.[0] ?? `ERRNO_${errno}`;
  const error = new Error(
    `Browser Audit artifact ${syscall} failed for ${entryName} with errno ${errno ?? 'unknown'}`
  ) as NodeJS.ErrnoException;
  error.code = code;
  error.errno = errno ?? undefined;
  error.path = entryName;
  error.syscall = syscall;
  return error;
};
