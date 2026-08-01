#!/usr/bin/env bun
/**
 * Delete legacy GHCR packages that are no longer referenced by CI, release,
 * or Compose after the Phase 2+3 image consolidation (issue #14).
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
const DRY_RUN = process.argv.includes('--dry-run');

async function deletePackage(name: string): Promise<{ name: string; ok: boolean; error?: string }> {
  const url = `/orgs/${ORG}/packages/container/${name}`;
  try {
    const proc = Bun.spawn(['gh', 'api', '--method', 'DELETE', url], {
      stdout: 'pipe',
      stderr: 'pipe'
    });
    const [exitCode] = await Promise.all([proc.exited]);
    if (exitCode === 0) {
      return { name, ok: true };
    }
    const stderr = await new Response(proc.stderr).text();
    return { name, ok: false, error: stderr.trim() };
  } catch (error) {
    return { name, ok: false, error: error instanceof Error ? error.message : String(error) };
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
let failed = 0;

for (const name of LEGACY_PACKAGES) {
  process.stdout.write(`  Deleting ${name}... `);
  const result = await deletePackage(name);
  if (result.ok) {
    console.log('OK');
    succeeded++;
  } else {
    console.log(`FAILED: ${result.error}`);
    failed++;
  }
}

console.log('');
console.log(`Done: ${succeeded} deleted, ${failed} failed.`);

if (failed > 0) {
  console.log('');
  console.log('If you see 403 errors, run:');
  console.log('  gh auth refresh --scopes delete:packages');
  process.exit(1);
}
