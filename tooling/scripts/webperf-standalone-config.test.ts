import { describe, expect, test } from 'bun:test';
import {
  assertStandaloneSupervisorEnvironment,
  assertStandalonePortsDistinct,
  isolateStandaloneChildArgv,
  parseStandalonePort,
  parseStandaloneStartupTimeoutMs,
  resolveStandaloneApiBinding,
  selectStandaloneSecrets,
  standaloneChildIdentities,
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

  test('isolates each child under a distinct non-root Linux identity', () => {
    expect(new Set(
      Object.values(standaloneChildIdentities).map(({ uid, gid }) => `${uid}:${gid}`)
    ).size).toBe(3);
    expect(Object.values(standaloneChildIdentities).every(({ uid, gid }) => (
      uid > 0 && gid > 0
    ))).toBeTrue();
    expect(isolateStandaloneChildArgv('console', ['bun', 'console.js'])).toEqual([
      '/usr/bin/setpriv',
      '--reuid=10001',
      '--regid=10001',
      '--clear-groups',
      '--no-new-privs',
      '--',
      'bun',
      'console.js'
    ]);
  });

  test('requires a Linux root supervisor before dropping child identities', () => {
    expect(assertStandaloneSupervisorEnvironment('linux', 0)).toBeUndefined();
    expect(() => assertStandaloneSupervisorEnvironment('linux', 1_000))
      .toThrow('must start as UID 0');
    expect(() => assertStandaloneSupervisorEnvironment('darwin', 0))
      .toThrow('requires a Linux container runtime');
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

  test('rejects a console and API port collision in the shared network namespace', () => {
    expect(() => assertStandalonePortsDistinct(8788, 8788))
      .toThrow('PORT and SELFHOST_API_PORT must use different ports');
    expect(assertStandalonePortsDistinct(3000, 8788)).toBeUndefined();
  });

  test('names the invalid standalone port in configuration diagnostics', () => {
    expect(() => parseStandalonePort('PORT', 'invalid', 3000))
      .toThrow('PORT must be an integer between 1 and 65535');
    expect(() => parseStandalonePort('SELFHOST_API_PORT', '70000', 8788))
      .toThrow('SELFHOST_API_PORT must be an integer between 1 and 65535');
    expect(parseStandalonePort('PORT', undefined, 3000)).toBe(3000);
  });
});
