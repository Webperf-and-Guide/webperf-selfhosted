import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const ignoredDirectories = new Set([
  '.git',
  'node_modules',
  '.turbo',
  '.wrangler',
  '.svelte-kit',
  'dist',
  'build',
  'coverage',
  'output'
]);
const allowedExtensions = new Set([
  '',
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.sh',
  '.hcl',
  '.yml',
  '.yaml',
  '.toml',
  '.svelte'
]);
const ignoredFiles = new Set([
  'bun.lock',
  'tooling/scripts/check-boundaries.ts',
  'tooling/scripts/check-retired-paths.ts'
]);

const banned = [
  { pattern: 'apps/control', message: 'use apps/api instead of the retired apps/control path' },
  {
    pattern: 'packages/env-schema',
    message: 'use packages/config instead of the retired packages/env-schema path'
  },
  {
    pattern: 'packages/report-engine',
    message: 'use packages/report-core instead of the retired packages/report-engine path'
  },
  {
    pattern: 'infra/compose',
    message: 'use infra/docker-compose instead of the retired infra/compose path'
  }
];

const targets = ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'package.json', 'apps', 'packages', 'docs', 'infra', 'tooling'];

const collectFiles = (target: string): string[] => {
  const absoluteTarget = join(root, target);
  const stats = statSync(absoluteTarget);

  if (stats.isFile()) {
    return [absoluteTarget];
  }

  const files: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) {
          continue;
        }

        walk(join(current, entry.name));
        continue;
      }

      const filePath = join(current, entry.name);
      const rel = relative(root, filePath);

      if (ignoredFiles.has(rel)) {
        continue;
      }

      if (!allowedExtensions.has(extname(entry.name))) {
        continue;
      }

      files.push(filePath);
    }
  };

  walk(absoluteTarget);
  return files;
};

const violations: string[] = [];

for (const target of targets) {
  for (const filePath of collectFiles(target)) {
    const rel = relative(root, filePath);
    const content = readFileSync(filePath, 'utf8');

    for (const rule of banned) {
      if (content.includes(rule.pattern)) {
        violations.push(`${rel}: ${rule.message}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Retired topology check failed:\n');

  for (const violation of violations) {
    console.error(`- ${violation}`);
  }

  process.exit(1);
}

console.log('Retired topology check passed.');
