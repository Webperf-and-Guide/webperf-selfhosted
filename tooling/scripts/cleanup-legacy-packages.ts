#!/usr/bin/env bun
/**
 * Preview or delete retired GHCR packages after the Phase 2+3 runtime-image
 * consolidation (issue #14).
 *
 * Usage:
 *   bun run tooling/scripts/cleanup-legacy-packages.ts             # preview only
 *   bun run tooling/scripts/cleanup-legacy-packages.ts --dry-run   # preview only
 *   bun run tooling/scripts/cleanup-legacy-packages.ts --execute   # delete eligible packages
 *
 * Live deletion requires an authenticated gh CLI token with the
 * `delete:packages` scope. Active packages are never eligible for deletion.
 */

export const CLEANUP_CANDIDATES = [
  'webperf-api',
  'webperf-console',
  'webperf-scheduler',
  'webperf-executor',
  'webperf-browser-audit-worker'
] as const;

export const ACTIVE_PACKAGES = [
  'webperf',
  'webperf-probe',
  'webperf-browser-audit-lighthouse'
] as const;

const ORG = 'Webperf-and-Guide';
const USAGE = 'Usage: bun run tooling/scripts/cleanup-legacy-packages.ts [--dry-run | --execute]';

type CleanupMode = 'preview' | 'execute';

export type PackageDeleteResult = {
  name: string;
  ok: boolean;
  alreadyGone: boolean;
  error?: string;
};

export type GhDeleteAccessCheck =
  | { ok: true }
  | { ok: false; reason: 'gh_unavailable' | 'missing_delete_packages_scope' };

type CleanupIo = {
  log(message?: string): void;
  error(message: string): void;
  write(message: string): void;
};

type CleanupDependencies = {
  verifyGhDeleteAccess(): Promise<GhDeleteAccessCheck>;
  deletePackage(name: string): Promise<PackageDeleteResult>;
  io: CleanupIo;
};

export const parseCleanupMode = (args: readonly string[]): CleanupMode => {
  const validArguments = new Set(['--dry-run', '--execute']);
  const unknownArguments = args.filter((argument) => !validArguments.has(argument));

  if (unknownArguments.length > 0) {
    throw new Error(`Unknown argument(s): ${unknownArguments.join(', ')}`);
  }

  if (args.includes('--dry-run') && args.includes('--execute')) {
    throw new Error('--dry-run and --execute cannot be used together');
  }

  return args.includes('--execute') ? 'execute' : 'preview';
};

export const findProtectedPackageConflicts = (
  candidates: readonly string[],
  activePackages: readonly string[]
): string[] => {
  const protectedPackages = new Set(activePackages);
  return candidates.filter((name) => protectedPackages.has(name));
};

const normalizeGhError = (stderr: string, exitCode: number): string => {
  const message = stderr.trim().replace(/\s+/g, ' ').slice(0, 500);
  return message || `gh exited with status ${exitCode}`;
};

export const hasDeletePackagesScope = (response: string): boolean => {
  const scopeHeader = response
    .split(/\r?\n/)
    .find((line) => line.toLowerCase().startsWith('x-oauth-scopes:'));
  if (!scopeHeader) {
    return false;
  }

  return scopeHeader
    .slice(scopeHeader.indexOf(':') + 1)
    .split(',')
    .map((scope) => scope.trim())
    .includes('delete:packages');
};

const verifyGhDeleteAccess = async (): Promise<GhDeleteAccessCheck> => {
  try {
    const proc = Bun.spawn(['gh', 'api', '--include', '/user'], {
      stdout: 'pipe',
      // Do not reflect raw gh transport/authentication diagnostics; classify
      // the failure below and give the operator a safe remediation command.
      stderr: 'ignore'
    });
    const stdoutPromise = new Response(proc.stdout).text();
    const [exitCode, stdout] = await Promise.all([
      proc.exited,
      stdoutPromise
    ]);

    if (exitCode !== 0) {
      return { ok: false, reason: 'gh_unavailable' };
    }

    return hasDeletePackagesScope(stdout)
      ? { ok: true }
      : { ok: false, reason: 'missing_delete_packages_scope' };
  } catch {
    return { ok: false, reason: 'gh_unavailable' };
  }
};

const deletePackage = async (name: string): Promise<PackageDeleteResult> => {
  const url = `/orgs/${ORG}/packages/container/${encodeURIComponent(name)}`;

  try {
    const proc = Bun.spawn(['gh', 'api', '--method', 'DELETE', url], {
      stdout: 'ignore',
      stderr: 'pipe'
    });
    const stderrPromise = new Response(proc.stderr).text();
    const [exitCode, stderr] = await Promise.all([proc.exited, stderrPromise]);

    if (exitCode === 0) {
      return { name, ok: true, alreadyGone: false };
    }

    const normalizedError = normalizeGhError(stderr, exitCode);
    if (normalizedError.includes('404') || normalizedError.toLowerCase().includes('not found')) {
      return { name, ok: true, alreadyGone: true };
    }

    return { name, ok: false, alreadyGone: false, error: normalizedError };
  } catch (error) {
    return {
      name,
      ok: false,
      alreadyGone: false,
      error: error instanceof Error ? error.message.slice(0, 500) : 'Unable to start gh'
    };
  }
};

export const executePackageDeletes = async (
  candidates: readonly string[],
  deleteCandidate: (name: string) => Promise<PackageDeleteResult>,
  io: CleanupIo
): Promise<{ ok: boolean; deleted: number; alreadyGone: number }> => {
  let deleted = 0;
  let alreadyGone = 0;

  for (const name of candidates) {
    io.write(`  Deleting ${name}... `);
    const result = await deleteCandidate(name);

    if (result.ok && result.alreadyGone) {
      io.log('OK (already gone)');
      alreadyGone += 1;
      continue;
    }

    if (result.ok) {
      io.log('OK');
      deleted += 1;
      continue;
    }

    io.log(`FAILED: ${result.error ?? 'unknown gh error'}`);
    io.error('Aborting after the first unexpected error to avoid a partial cleanup.');
    return { ok: false, deleted, alreadyGone };
  }

  return { ok: true, deleted, alreadyGone };
};

const defaultDependencies: CleanupDependencies = {
  verifyGhDeleteAccess,
  deletePackage,
  io: {
    log: (message = '') => console.log(message),
    error: (message) => console.error(message),
    write: (message) => process.stdout.write(message)
  }
};

export const runLegacyPackageCleanup = async (
  args: readonly string[],
  dependencies: CleanupDependencies = defaultDependencies
): Promise<number> => {
  let mode: CleanupMode;

  try {
    mode = parseCleanupMode(args);
  } catch (error) {
    dependencies.io.error(error instanceof Error ? error.message : 'Invalid arguments');
    dependencies.io.error(USAGE);
    return 2;
  }

  const conflicts = findProtectedPackageConflicts(
    CLEANUP_CANDIDATES,
    ACTIVE_PACKAGES
  );
  if (conflicts.length > 0) {
    dependencies.io.error(`FATAL: cleanup candidates include protected packages: ${conflicts.join(', ')}`);
    return 2;
  }

  dependencies.io.log(`${mode === 'preview' ? '[PREVIEW] ' : ''}Legacy GHCR package cleanup for ${ORG}`);
  dependencies.io.log(`Active packages: ${ACTIVE_PACKAGES.join(', ')}`);
  dependencies.io.log();

  if (mode === 'preview') {
    for (const name of CLEANUP_CANDIDATES) {
      dependencies.io.log(`  Would delete: ${name}`);
    }
    dependencies.io.log();
    dependencies.io.log('Pass --execute to perform the listed deletions.');
    return 0;
  }

  const accessCheck = await dependencies.verifyGhDeleteAccess();
  if (!accessCheck.ok) {
    const message = accessCheck.reason === 'missing_delete_packages_scope'
      ? 'GitHub token is missing delete:packages. Run `gh auth refresh --scopes delete:packages` and retry.'
      : 'GitHub CLI access check failed. Run `gh auth status --hostname github.com` and retry.';
    dependencies.io.error(message);
    return 1;
  }

  const result = await executePackageDeletes(
    CLEANUP_CANDIDATES,
    dependencies.deletePackage,
    dependencies.io
  );
  if (!result.ok) {
    return 1;
  }

  dependencies.io.log();
  dependencies.io.log(`Done: ${result.deleted} deleted, ${result.alreadyGone} already gone.`);
  return 0;
};

if (import.meta.main) {
  process.exit(await runLegacyPackageCleanup(process.argv.slice(2)));
}
