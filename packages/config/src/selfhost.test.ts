import { describe, expect, test } from 'bun:test';
import { parseSelfhostApiVars } from './selfhost';
import { parseSelfhostConsoleVars } from './selfhost-console';
import { parseSelfhostSchedulerVars } from './selfhost-scheduler';
import { parseSelfhostExecutorVars } from './selfhost-executor';

const requiredApiSecrets = {
  SELFHOST_ADMIN_TOKEN: 'test-admin-token-value',
  SELFHOST_INTERNAL_SECRET: 'test-internal-secret-value',
  PROBE_SHARED_SECRET: 'test-probe-secret-value',
  BROWSER_AUDIT_SHARED_SECRET: 'test-browser-secret-value'
};

describe('strict self-host configuration', () => {
  test('requires every production API secret and does not invent fallbacks', () => {
    expect(() => parseSelfhostApiVars({})).toThrow();
    expect(parseSelfhostApiVars(requiredApiSecrets)).toMatchObject(requiredApiSecrets);
  });

  test('requires server-side console, scheduler, and executor credentials', () => {
    expect(() => parseSelfhostConsoleVars({})).toThrow();
    expect(() => parseSelfhostSchedulerVars({})).toThrow();
    expect(() => parseSelfhostExecutorVars({})).toThrow();
    expect(
      parseSelfhostConsoleVars({ SELFHOST_ADMIN_TOKEN: requiredApiSecrets.SELFHOST_ADMIN_TOKEN })
        .CONTROL_BASE_URL
    ).toBe('http://127.0.0.1:8788');
    expect(
      parseSelfhostSchedulerVars({
        SELFHOST_INTERNAL_SECRET: requiredApiSecrets.SELFHOST_INTERNAL_SECRET
      }).SELFHOST_SCHEDULER_API_BASE_URL
    ).toBe('http://127.0.0.1:8788');
    expect(
      parseSelfhostExecutorVars({
        SELFHOST_INTERNAL_SECRET: requiredApiSecrets.SELFHOST_INTERNAL_SECRET,
        PROBE_SHARED_SECRET: requiredApiSecrets.PROBE_SHARED_SECRET
      })
    ).toMatchObject({
      SELFHOST_EXECUTOR_LEASE_DURATION_MS: 60_000,
      SELFHOST_EXECUTOR_MAX_EXECUTION_MS: 900_000
    });
    expect(() =>
      parseSelfhostExecutorVars({
        SELFHOST_INTERNAL_SECRET: requiredApiSecrets.SELFHOST_INTERNAL_SECRET,
        PROBE_SHARED_SECRET: requiredApiSecrets.PROBE_SHARED_SECRET,
        SELFHOST_EXECUTOR_LEASE_DURATION_MS: 10_000,
        SELFHOST_EXECUTOR_HEARTBEAT_INTERVAL_MS: 5_000
      })
    ).toThrow('heartbeat interval');
    expect(() =>
      parseSelfhostExecutorVars({
        SELFHOST_INTERNAL_SECRET: requiredApiSecrets.SELFHOST_INTERNAL_SECRET,
        PROBE_SHARED_SECRET: requiredApiSecrets.PROBE_SHARED_SECRET,
        SELFHOST_EXECUTOR_API_BASE_URL: 'https://operator:secret@api.example.test?token=secret'
      })
    ).toThrow('without path');
  });
});
