import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { startProcessHeartbeat } from './selfhost-process-heartbeat';

describe('self-host process heartbeat', () => {
  test('writes immediately and contains later write failures', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'webperf-heartbeat-'));
    const heartbeatPath = join(directory, 'worker');
    let writeFailures = 0;
    const stop = startProcessHeartbeat({
      heartbeatPath,
      intervalMs: 5,
      onWriteFailure: () => {
        writeFailures += 1;
      }
    });

    try {
      expect(Number.parseInt(readFileSync(heartbeatPath, 'utf8'), 10)).toBeGreaterThan(0);
      rmSync(directory, { recursive: true, force: true });
      await Bun.sleep(25);
      expect(writeFailures).toBe(1);
    } finally {
      stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('fails fast when the first heartbeat cannot be written', () => {
    const removedDirectory = mkdtempSync(join(tmpdir(), 'webperf-heartbeat-missing-'));
    rmSync(removedDirectory, { recursive: true, force: true });

    expect(() => startProcessHeartbeat({
      heartbeatPath: join(removedDirectory, 'worker')
    })).toThrow();
  });
});
