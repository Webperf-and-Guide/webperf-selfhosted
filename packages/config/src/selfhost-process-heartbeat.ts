import { writeFileSync } from 'node:fs';

export const defaultProcessHeartbeatIntervalMs = 10_000;

export const startProcessHeartbeat = ({
  heartbeatPath,
  intervalMs = defaultProcessHeartbeatIntervalMs,
  onWriteFailure = () => {}
}: {
  heartbeatPath: string;
  intervalMs?: number;
  onWriteFailure?: () => void;
}) => {
  const normalizedPath = heartbeatPath.trim();
  if (!normalizedPath) {
    throw new Error('Process heartbeat path must not be empty');
  }
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
    throw new Error('Process heartbeat interval must be a positive integer');
  }

  let writeFailed = false;
  const writeHeartbeat = (failFast: boolean) => {
    try {
      writeFileSync(normalizedPath, `${Date.now()}\n`, {
        encoding: 'utf8',
        mode: 0o600
      });
      writeFailed = false;
    } catch (error) {
      if (failFast) {
        throw error;
      }
      if (!writeFailed) {
        writeFailed = true;
        try {
          onWriteFailure();
        } catch {
          // A diagnostic callback must not turn a stale heartbeat into a process crash.
        }
      }
    }
  };

  writeHeartbeat(true);
  const interval = setInterval(() => writeHeartbeat(false), intervalMs);
  interval.unref();

  return () => clearInterval(interval);
};
