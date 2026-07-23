import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { startProcessHeartbeat } from './selfhost-process-heartbeat';

describe('self-host process heartbeat', () => {
  test('writes immediately and contains later write failures', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'webperf-heartbeat-'));
    const heartbeatPath = join(directory, 'worker');
    let writeFailures = 0;
    const stop = await startProcessHeartbeat({
      heartbeatPath,
      intervalMs: 5,
      failureReportIntervalMs: 10,
      onWriteFailure: () => {
        writeFailures += 1;
      }
    });

    try {
      expect(Number.parseInt(readFileSync(heartbeatPath, 'utf8'), 10)).toBeGreaterThan(0);
      rmSync(directory, { recursive: true, force: true });
      await Bun.sleep(25);
      expect(writeFailures).toBeGreaterThanOrEqual(1);
    } finally {
      stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('fails fast when the first heartbeat cannot be written', async () => {
    const removedDirectory = mkdtempSync(join(tmpdir(), 'webperf-heartbeat-missing-'));
    rmSync(removedDirectory, { recursive: true, force: true });

    await expect(startProcessHeartbeat({
      heartbeatPath: join(removedDirectory, 'worker')
    })).rejects.toThrow();
  });

  test('tightens an existing heartbeat file to owner-only permissions', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'webperf-heartbeat-mode-'));
    const heartbeatPath = join(directory, 'worker');
    writeFileSync(heartbeatPath, 'stale\n', { mode: 0o644 });
    chmodSync(heartbeatPath, 0o644);

    const stop = await startProcessHeartbeat({ heartbeatPath });
    try {
      expect(statSync(heartbeatPath).mode & 0o777).toBe(0o600);
    } finally {
      stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('bounds a periodic write that only settles after abort', async () => {
    let writeCount = 0;
    let failureCount = 0;
    const stop = await startProcessHeartbeat({
      heartbeatPath: '/unused/test-heartbeat',
      intervalMs: 2,
      writeTimeoutMs: 5,
      failureReportIntervalMs: 1,
      writeHeartbeat: async (_path, _contents, signal) => {
        writeCount += 1;
        if (writeCount === 1) {
          return;
        }
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
      onWriteFailure: () => {
        failureCount += 1;
      }
    });

    try {
      await Bun.sleep(20);
      expect(writeCount).toBeGreaterThanOrEqual(2);
      expect(failureCount).toBeGreaterThanOrEqual(1);
    } finally {
      stop();
    }
  });
});
