#!/usr/bin/env bun
/**
 * Delete legacy GHCR packages that are no longer referenced by CI, release,
 * or Compose after the Phase 2+3 image consolidation (issue #14).
 *
 * These packages were published up to v0.4.0 and may still be pulled by
 * operators pinned to an older digest-pinned Compose bundle. Do NOT run
 * this script until you are confident no operator needs the old images
 * for a cross-version upgrade drill.
 *
 * Usage:
 *   bun run tooling/scripts/cleanup-legacy-packages.ts --dry-run   # list what would be deleted
 *   bun run tooling/scripts/cleanup-legacy-packages.ts             # actually delete
 *
 * Requires a gh token with the `delete:packages` scope:
 *   gh auth refresh --scopes delete:packages
 *
 * The active packages (webperf, webperf-probe, webperf-browser-audit-lighthouse)
 * are never deleted.
 */

const LEGACY_PACKAGES = [
  'webperf-api',
  'webperf-console',
  'webperf-scheduler',
  'webperf-executor',
  'webperf-browser-audit-worker'
];

const ACTIVE_PACKAGES = [
  'webperf',
  'webperf-probe',
  'webperf-browser-audit-lighthouse'
];

const ORG = 'Webperf-and-Guide';

// Reject unknown arguments so a typo like --help or --force doesn't
// silently select live deletion mode.
const VALID_ARGS = new Set(['--dry-run', process.argv[0], process.argv[1]]);
const unknownArgs = process.argv.filter((arg) => !VALID_ARGS.has(arg));
if (unknownArgs.length > 0) {
  console.error(`Unknown argument(s): ${unknownArgs.join(', ')}`);
  console.error('Usage: bun run tooling/scripts/cleanup-legacy-packages.ts [--dry-run]');
  process.exit(2);
}

const DRY_RUN = process.argv.includes('--dry-run');

// Guard: if a legacy list accidentally contains an active package, abort.
const conflict = LEGACY_PACKAGES.filter((name) => ACTIVE_PACKAGES.includes(name));
if (conflict.length > 0) {
  console.error(`FATAL: these packages are in both LEGACY and ACTIVE lists: ${conflict.join(', ')}`);
  process.exit(2);
}

async function deletePackage(name: string): Promise<{ name: string; ok: boolean; alreadyGone: boolean; error?: string }> {
  const url = `/orgs/${ORG}/packages/container/${name}`;
  try {
    const proc = Bun.spawn(['gh', 'api', '--method', 'DELETE', url], {
      stdout: 'pipe',
      stderr: 'pipe'
    });
    const [exitCode] = await Promise.all([proc.exited]);
    if (exitCode === 0) {
      return { name, ok: true, alreadyGone: false };
    }
    const stderr = await new Response(proc.stderr).text();
    // 404 / "not found" means the package was already deleted in a prior run — treat as success.
    if (stderr.includes('404') || stderr.toLowerCase().includes('not found')) {
      return { name, ok: true, alreadyGone: true };
    }
    return { name, ok: false, alreadyGone: false, error: stderr.trim() };
  } catch (error) {
    return { name, ok: false, alreadyGone: false, error: error instanceof Error ? error.message : String(error) };
  }
}

console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Legacy GHCR package cleanup for ${ORG}`);
console.log(`Active packages (never deleted): ${ACTIVE_PACKAGES.join(', ')}`);
console.log('');

if (DRY_RUN) {
  for (const name of LEGACY_PACKAGES) {
    console.log(`  Would delete: ${name}`);
  }
  console.log('');
  console.log('Run without --dry-run to actually delete.');
  process.exit(0);
}

let succeeded = 0;
let alreadyGone = 0;
let failed = 0;

for (const name of LEGACY_PACKAGES) {
  process.stdout.write(`  Deleting ${name}... `);
  const result = await deletePackage(name);
  if (result.ok && result.alreadyGone) {
    console.log('OK (already gone)');
    alreadyGone++;
  } else if (result.ok) {
    console.log('OK');
    succeeded++;
  } else {
    console.log(`FAILED: ${result.error}`);
    failed++;
  }
}

console.log('');
console.log(`Done: ${succeeded} deleted, ${alreadyGone} already gone, ${failed} failed.`);

if (failed > 0) {
  console.log('');
  console.log('If you see 403 errors, run:');
  console.log('  gh auth refresh --scopes delete:packages');
  process.exit(1);
}
