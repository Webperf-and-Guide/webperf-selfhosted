import { writeFile } from 'node:fs/promises';

export const defaultProcessHeartbeatIntervalMs = 10_000;
export const defaultProcessHeartbeatFailureReportIntervalMs = 5 * 60_000;

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
  onWriteFailure = () => {}
}: {
  heartbeatPath: string;
  intervalMs?: number;
  failureReportIntervalMs?: number;
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

  let stopped = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let lastFailureReportedAt: number | null = null;
  const writeHeartbeatFile = () => writeFile(normalizedPath, `${Date.now()}\n`, {
    encoding: 'utf8',
    mode: 0o600
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
      lastFailureReportedAt = null;
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
