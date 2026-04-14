import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '..', '..');
const drizzleDir = join(repoRoot, 'infra', 'cloudflare', 'drizzle');
const cloudflareDir = join(repoRoot, 'infra', 'cloudflare', 'd1');

mkdirSync(cloudflareDir, { recursive: true });

const migrationDirs = readdirSync(drizzleDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(drizzleDir, entry.name, 'migration.sql')))
  .map((entry) => entry.name)
  .sort();

const latest = migrationDirs.at(-1);

if (!latest) {
  throw new Error('No Drizzle migration directory was found to promote.');
}

const existing = readdirSync(cloudflareDir)
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort();

const nextNumber =
  existing.length === 0
    ? 1
    : Number.parseInt(existing.at(-1)!.split('_')[0]!.replace('.sql', ''), 10) + 1;

const suffix = latest.replace(/^\d+_/, '');
const targetName = `${String(nextNumber).padStart(4, '0')}_${suffix}.sql`;
const sourceFile = join(drizzleDir, latest, 'migration.sql');
const targetFile = join(cloudflareDir, targetName);
const sourceContents = readFileSync(sourceFile, 'utf8');
const wrappedContents = `-- promoted from drizzle/${latest}/migration.sql\n${sourceContents}`;

writeFileSync(targetFile, wrappedContents);

console.log(
  JSON.stringify({
    ok: true,
    source: sourceFile,
    target: targetFile,
    targetName
  })
);
