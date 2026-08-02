import { describe, expect, test } from 'bun:test';
import {
  ACTIVE_PACKAGES,
  CLEANUP_CANDIDATES,
  SUPPORTED_UPGRADE_PACKAGES,
  executePackageDeletes,
  findProtectedPackageConflicts,
  hasDeletePackagesScope,
  parseCleanupMode,
  runLegacyPackageCleanup,
  type PackageDeleteResult
} from './cleanup-legacy-packages';

const createIo = () => {
  const output: string[] = [];
  return {
    output,
    io: {
      log: (message = '') => output.push(message),
      error: (message: string) => output.push(`ERROR: ${message}`),
      write: (message: string) => output.push(message)
    }
  };
};

describe('legacy GHCR package cleanup', () => {
  test('defaults to preview and requires an explicit execute flag', () => {
    expect(parseCleanupMode([])).toBe('preview');
    expect(parseCleanupMode(['--dry-run'])).toBe('preview');
    expect(parseCleanupMode(['--execute'])).toBe('execute');
    expect(() => parseCleanupMode(['--dry-run', '--execute'])).toThrow('cannot be used together');
    expect(() => parseCleanupMode(['--force'])).toThrow('Unknown argument');
  });

  test('requires the exact delete:packages OAuth scope', () => {
    expect(hasDeletePackagesScope(
      'HTTP/2.0 200 OK\r\nX-Oauth-Scopes: repo, read:packages, delete:packages\r\n'
    )).toBe(true);
    expect(hasDeletePackagesScope(
      'HTTP/2.0 200 OK\nX-Oauth-Scopes: repo, read:packages\n'
    )).toBe(false);
    expect(hasDeletePackagesScope('HTTP/2.0 200 OK\n')).toBe(false);
  });

  test('keeps active and supported-upgrade packages out of the cleanup plan', () => {
    expect([...CLEANUP_CANDIDATES]).toEqual(['webperf-browser-audit-worker']);
    expect([...SUPPORTED_UPGRADE_PACKAGES]).toEqual([
      'webperf-api',
      'webperf-console',
      'webperf-scheduler',
      'webperf-executor'
    ]);
    expect(findProtectedPackageConflicts(
      CLEANUP_CANDIDATES,
      ACTIVE_PACKAGES,
      SUPPORTED_UPGRADE_PACKAGES
    )).toEqual([]);
    expect(findProtectedPackageConflicts(
      ['webperf-api', 'webperf'],
      ACTIVE_PACKAGES,
      SUPPORTED_UPGRADE_PACKAGES
    )).toEqual(['webperf-api', 'webperf']);
  });

  test('does not authenticate or delete during the default preview', async () => {
    const { io, output } = createIo();
    let authenticated = false;
    const deleted: string[] = [];

    const exitCode = await runLegacyPackageCleanup([], {
      io,
      verifyGhDeleteAccess: async () => {
        authenticated = true;
        return { ok: true };
      },
      deletePackage: async (name): Promise<PackageDeleteResult> => {
        deleted.push(name);
        return { name, ok: true, alreadyGone: false };
      }
    });

    expect(exitCode).toBe(0);
    expect(authenticated).toBe(false);
    expect(deleted).toEqual([]);
    expect(output).toContain(`  Would delete: ${CLEANUP_CANDIDATES[0]}`);
  });

  test('does not delete when GitHub CLI authentication fails', async () => {
    const { io, output } = createIo();
    const deleted: string[] = [];

    const exitCode = await runLegacyPackageCleanup(['--execute'], {
      io,
      verifyGhDeleteAccess: async () => ({ ok: false, reason: 'gh_unavailable' }),
      deletePackage: async (name) => {
        deleted.push(name);
        return { name, ok: true, alreadyGone: false };
      }
    });

    expect(exitCode).toBe(1);
    expect(deleted).toEqual([]);
    expect(output.some((message) => message.includes('gh auth status'))).toBe(true);
  });

  test('does not delete when the token lacks delete:packages', async () => {
    const { io, output } = createIo();
    const deleted: string[] = [];

    const exitCode = await runLegacyPackageCleanup(['--execute'], {
      io,
      verifyGhDeleteAccess: async () => ({
        ok: false,
        reason: 'missing_delete_packages_scope'
      }),
      deletePackage: async (name) => {
        deleted.push(name);
        return { name, ok: true, alreadyGone: false };
      }
    });

    expect(exitCode).toBe(1);
    expect(deleted).toEqual([]);
    expect(output.some((message) => message.includes('gh auth refresh'))).toBe(true);
  });

  test('deletes only eligible candidates in execute mode', async () => {
    const { io } = createIo();
    const deleted: string[] = [];

    const exitCode = await runLegacyPackageCleanup(['--execute'], {
      io,
      verifyGhDeleteAccess: async () => ({ ok: true }),
      deletePackage: async (name) => {
        deleted.push(name);
        return { name, ok: true, alreadyGone: false };
      }
    });

    expect(exitCode).toBe(0);
    expect(deleted).toEqual([...CLEANUP_CANDIDATES]);
    expect(deleted.some((name) => SUPPORTED_UPGRADE_PACKAGES.includes(
      name as typeof SUPPORTED_UPGRADE_PACKAGES[number]
    ))).toBe(false);
  });

  test('stops after the first unexpected deletion error', async () => {
    const { io } = createIo();
    const attempted: string[] = [];

    const result = await executePackageDeletes(
      ['first', 'second'],
      async (name) => {
        attempted.push(name);
        return { name, ok: false, alreadyGone: false, error: 'forbidden' };
      },
      io
    );

    expect(result.ok).toBe(false);
    expect(attempted).toEqual(['first']);
  });

  test('counts an already-removed package as an idempotent success', async () => {
    const { io } = createIo();

    const result = await executePackageDeletes(
      ['already-gone'],
      async (name) => ({ name, ok: true, alreadyGone: true }),
      io
    );

    expect(result).toEqual({ ok: true, deleted: 0, alreadyGone: 1 });
  });
});
