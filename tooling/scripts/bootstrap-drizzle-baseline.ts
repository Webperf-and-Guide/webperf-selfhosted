import { Database } from 'bun:sqlite';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dir, '..', '..');
const sourceDir = join(repoRoot, 'infra', 'cloudflare', 'd1');
const outDir = join(repoRoot, 'infra', 'cloudflare', 'drizzle');
const tempDir = join(repoRoot, '.wrangler', 'tmp', 'drizzle-baseline');
const baselineDbPath = join(tempDir, 'baseline.sqlite');

mkdirSync(tempDir, { recursive: true });
mkdirSync(dirname(baselineDbPath), { recursive: true });
rmSync(baselineDbPath, { force: true });
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const db = new Database(baselineDbPath, { create: true });
const migrationFiles = readdirSync(sourceDir)
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort();

for (const file of migrationFiles) {
  db.exec(readFileSync(join(sourceDir, file), 'utf8'));
}

db.close();

const result = spawnSync(
  'bunx',
  ['drizzle-kit', 'pull', '--dialect', 'sqlite', '--url', baselineDbPath, '--out', outDir],
  {
    cwd: repoRoot,
    stdio: 'inherit'
  }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(
  JSON.stringify({
    ok: true,
    baselineDbPath,
    outDir,
    sourceMigrations: migrationFiles
  })
);
