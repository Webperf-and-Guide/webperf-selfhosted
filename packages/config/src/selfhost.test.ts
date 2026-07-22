import { describe, expect, test } from 'bun:test';
import { parseSelfhostApiVars } from './selfhost';
import { parseSelfhostConsoleVars } from './selfhost-console';
import { parseSelfhostSchedulerVars } from './selfhost-scheduler';

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

  test('requires server-side console and scheduler credentials', () => {
    expect(() => parseSelfhostConsoleVars({})).toThrow();
    expect(() => parseSelfhostSchedulerVars({})).toThrow();
    expect(
      parseSelfhostConsoleVars({ SELFHOST_ADMIN_TOKEN: requiredApiSecrets.SELFHOST_ADMIN_TOKEN })
        .CONTROL_BASE_URL
    ).toBe('http://127.0.0.1:8788');
    expect(
      parseSelfhostSchedulerVars({
        SELFHOST_INTERNAL_SECRET: requiredApiSecrets.SELFHOST_INTERNAL_SECRET
      }).SELFHOST_SCHEDULER_API_BASE_URL
    ).toBe('http://127.0.0.1:8788');
  });
});
