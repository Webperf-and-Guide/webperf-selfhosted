import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export const defaultProcessHeartbeatIntervalMs = 10_000;
export const defaultProcessHeartbeatFailureReportIntervalMs = 5 * 60_000;
export const defaultProcessHeartbeatWriteTimeoutMs = 5_000;

export type ProcessHeartbeatWriter = (
  heartbeatPath: string,
  contents: string,
  signal: AbortSignal
) => Promise<void>;

/**
 * Starts a self-host worker heartbeat containing a Unix timestamp and newline.
 * The initial write is awaited and rejects on failure. Later writes run serially
 * without blocking the event loop; persistent failures invoke `onWriteFailure`
 * at most once per reporting interval. The returned function stops future writes.
 */
export const startProcessHeartbeat = async ({
  heartbeatPath,
  intervalMs = defaultProcessHeartbeatIntervalMs,
  failureReportIntervalMs = defaultProcessHeartbeatFailureReportIntervalMs,
  writeTimeoutMs = defaultProcessHeartbeatWriteTimeoutMs,
  writeHeartbeat = writePrivateHeartbeatFile,
  onWriteFailure = () => {}
}: {
  heartbeatPath: string;
  intervalMs?: number;
  failureReportIntervalMs?: number;
  writeTimeoutMs?: number;
  writeHeartbeat?: ProcessHeartbeatWriter;
  onWriteFailure?: () => void;
}) => {
  const normalizedPath = heartbeatPath.trim();
  if (!normalizedPath) {
    throw new Error('Process heartbeat path must not be empty');
  }
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
    throw new Error('Process heartbeat interval must be a positive integer');
  }
  if (
    !Number.isSafeInteger(failureReportIntervalMs)
    || failureReportIntervalMs < 1
  ) {
    throw new Error('Process heartbeat failure report interval must be a positive integer');
  }
  if (!Number.isSafeInteger(writeTimeoutMs) || writeTimeoutMs < 1) {
    throw new Error('Process heartbeat write timeout must be a positive integer');
  }

  let stopped = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let lastFailureReportedAt: number | null = null;
  const writeHeartbeatFile = () => writeHeartbeatWithinDeadline({
    heartbeatPath: normalizedPath,
    contents: `${Date.now()}\n`,
    timeoutMs: writeTimeoutMs,
    writeHeartbeat
  });

  const reportWriteFailure = () => {
    const now = Date.now();
    if (
      lastFailureReportedAt !== null
      && now - lastFailureReportedAt < failureReportIntervalMs
    ) {
      return;
    }
    lastFailureReportedAt = now;

    try {
      onWriteFailure();
    } catch {
      // A diagnostic callback must not turn a stale heartbeat into a process crash.
      reportHeartbeatDiagnosticFailure();
    }
  };

  const scheduleNextWrite = () => {
    if (stopped) {
      return;
    }
    timeout = setTimeout(() => void writePeriodicHeartbeat(), intervalMs);
    timeout.unref();
  };

  const writePeriodicHeartbeat = async () => {
    try {
      await writeHeartbeatFile();
    } catch {
      reportWriteFailure();
    } finally {
      scheduleNextWrite();
    }
  };

  await writeHeartbeatFile();
  scheduleNextWrite();

  return () => {
    stopped = true;
    if (timeout) {
      clearTimeout(timeout);
    }
  };
};

const writeHeartbeatWithinDeadline = async ({
  heartbeatPath,
  contents,
  timeoutMs,
  writeHeartbeat
}: {
  heartbeatPath: string;
  contents: string;
  timeoutMs: number;
  writeHeartbeat: ProcessHeartbeatWriter;
}) => {
  const controller = new AbortController();
  const operation = writeHeartbeat(heartbeatPath, contents, controller.signal);
  // A filesystem operation may finish after the deadline; always retain a
  // rejection observer even when the timeout branch wins.
  void operation.catch(() => undefined);
  let timeout: ReturnType<typeof setTimeout> | null = null;

  try {
    await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          const error = Object.assign(new Error('Process heartbeat write timed out'), {
            name: 'TimeoutError',
            code: 'ETIMEDOUT'
          });
          controller.abort(error);
          reject(error);
        }, timeoutMs);
        timeout.unref?.();
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const writePrivateHeartbeatFile: ProcessHeartbeatWriter = async (
  heartbeatPath,
  contents,
  signal
) => {
  const temporaryPath = join(
    dirname(heartbeatPath),
    `.${basename(heartbeatPath)}.${process.pid}.${randomUUID()}.tmp`
  );
  const handle = await open(
    temporaryPath,
    constants.O_WRONLY
      | constants.O_CREAT
      | constants.O_EXCL
      | constants.O_NOFOLLOW,
    0o600
  );
  let closed = false;
  let published = false;

  try {
    await handle.chmod(0o600);
    await handle.writeFile(contents, { encoding: 'utf8', signal });
    await handle.sync();
    await handle.close();
    closed = true;
    signal.throwIfAborted();
    await rename(temporaryPath, heartbeatPath);
    published = true;
  } finally {
    if (!closed) {
      await handle.close().catch(() => undefined);
    }
    if (!published) {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
};

const reportHeartbeatDiagnosticFailure = () => {
  try {
    console.error(JSON.stringify({
      level: 'error',
      event: 'process_heartbeat_failure_report_failed'
    }));
  } catch {
    // There is no safer fallback when the process console itself is unavailable.
  }
};
