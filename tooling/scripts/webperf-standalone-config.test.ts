import { describe, expect, test } from 'bun:test';
import {
  parseStandaloneStartupTimeoutMs,
  resolveStandaloneApiBinding,
  selectStandaloneSecrets,
  takeStandaloneSecrets
} from './webperf-standalone-config';

describe('standalone process configuration', () => {
  test('removes captured secrets from the supervisor environment', () => {
    const environment: Record<string, string | undefined> = {
      PATH: '/usr/bin',
      SELFHOST_ADMIN_TOKEN: 'admin-secret-value',
      SELFHOST_INTERNAL_SECRET: 'internal-secret-value',
      PROBE_SHARED_SECRET: 'probe-secret-value',
      BROWSER_AUDIT_SHARED_SECRET: 'browser-secret-value'
    };

    const secrets = takeStandaloneSecrets(environment);

    expect(environment).toEqual({ PATH: '/usr/bin' });
    expect(selectStandaloneSecrets(secrets, ['SELFHOST_ADMIN_TOKEN'])).toEqual({
      SELFHOST_ADMIN_TOKEN: 'admin-secret-value'
    });
    expect(selectStandaloneSecrets(secrets, [
      'SELFHOST_INTERNAL_SECRET',
      'PROBE_SHARED_SECRET',
      'BROWSER_AUDIT_SHARED_SECRET'
    ])).toEqual({
      SELFHOST_INTERNAL_SECRET: 'internal-secret-value',
      PROBE_SHARED_SECRET: 'probe-secret-value',
      BROWSER_AUDIT_SHARED_SECRET: 'browser-secret-value'
    });
  });

  test('connects wildcard binds through loopback and preserves explicit interfaces', () => {
    expect(resolveStandaloneApiBinding('0.0.0.0', 8788)).toEqual({
      bindHost: '0.0.0.0',
      origin: 'http://127.0.0.1:8788'
    });
    expect(resolveStandaloneApiBinding('::', 8788)).toEqual({
      bindHost: '::',
      origin: 'http://[::1]:8788'
    });
    expect(resolveStandaloneApiBinding('10.0.0.8', 8788)).toEqual({
      bindHost: '10.0.0.8',
      origin: 'http://10.0.0.8:8788'
    });
    expect(resolveStandaloneApiBinding('[2001:db8::8]', 8788)).toEqual({
      bindHost: '2001:db8::8',
      origin: 'http://[2001:db8::8]:8788'
    });
    expect(() => resolveStandaloneApiBinding('http://127.0.0.1', 8788))
      .toThrow('without a scheme or port');
  });

  test('waits without a deadline by default and bounds explicit deadlines', () => {
    expect(parseStandaloneStartupTimeoutMs(undefined)).toBe(0);
    expect(parseStandaloneStartupTimeoutMs('0')).toBe(0);
    expect(parseStandaloneStartupTimeoutMs('1800000')).toBe(1_800_000);
    expect(() => parseStandaloneStartupTimeoutMs('86400001')).toThrow('up to 86400000');
    expect(() => parseStandaloneStartupTimeoutMs('-1')).toThrow('up to 86400000');
  });
});
