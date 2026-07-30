import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { retiredReleasePaths } from './retired-release-paths';

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
  'tooling/scripts/check-release.ts',
  'tooling/scripts/check-retired-paths.ts',
  'tooling/scripts/retired-release-paths.ts'
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
  },
  {
    pattern: 'apps/browser-audit-worker',
    message: 'use apps/browser-audit-lighthouse for the reference runner'
  },
  ...retiredReleasePaths.map(({ path, message }) => ({ pattern: path, message }))
];

const targets = ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'package.json', '.github', 'apps', 'packages', 'docs', 'infra', 'tooling'];
const singleRegionCopyTargets = [
  'apps/console/src/lib/components/workspace',
  'apps/api/README.md',
  'apps/executor/README.md',
  'docs/console-ia.md',
  'docs/users/troubleshooting.md'
];
const retiredSingleRegionEnv = [
  {
    pattern: /SELFHOST_ACTIVE_REGION_CODES_JSON/,
    message: 'use SELFHOST_REGION_ID for the deployment runtime identity'
  },
  {
    pattern: /SELFHOST_REGION_IDS_JSON/,
    message: 'use SELFHOST_REGION_LABEL for the optional operator label'
  },
  {
    pattern: /SELFHOST_PROBE_BASE_URLS_JSON/,
    message: 'use the single SELFHOST_PROBE_BASE_URL origin'
  }
];
const retiredSingleRegionCopy = [
  {
    pattern: /\bregion sets?\b/i,
    message: 'describe the fixed runtime location instead of a selectable Region Set'
  },
  ...retiredSingleRegionEnv,
  {
    pattern: /missing_probe_region/,
    message: 'use the current missing_probe_origin or probe_region_mismatch diagnostics'
  }
];
const singleRegionEnvTargets = [
  'apps/api/test/http.test.ts',
  'apps/api/test/restart-recovery.test.ts'
];
const retiredRegionalRuntimeTargets = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  '.github',
  'apps/api/src/auth.ts',
  'apps/api/src/index.ts',
  'apps/executor/src',
  'docs',
  'infra/docker-compose',
  'package.json',
  'packages/config/src',
  'packages/contracts/src',
  'packages/domain-core/src',
  'tooling/scripts/webperf-role.ts'
];
const retiredRegionalRuntimeSurface = [
  {
    pattern: /SELFHOST_RUNTIME_MODE/,
    message: 'the self-hosted application has one standalone runtime mode'
  },
  {
    pattern: /REGIONAL_RUNTIME_SHARED_SECRET/,
    message: 'managed orchestration must authenticate directly to the stateless probe'
  },
  {
    pattern: /WEBPERF_ROLE\s*=\s*regional-runtime/,
    message: 'the unified image no longer exposes a regional-runtime role'
  }
];

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

for (const target of singleRegionCopyTargets) {
  for (const filePath of collectFiles(target)) {
    const rel = relative(root, filePath);
    const content = readFileSync(filePath, 'utf8');

    for (const rule of retiredSingleRegionCopy) {
      if (rule.pattern.test(content)) {
        violations.push(`${rel}: ${rule.message}`);
      }
    }
  }
}

for (const target of singleRegionEnvTargets) {
  for (const filePath of collectFiles(target)) {
    const rel = relative(root, filePath);
    const content = readFileSync(filePath, 'utf8');

    for (const rule of retiredSingleRegionEnv) {
      if (rule.pattern.test(content)) {
        violations.push(`${rel}: ${rule.message}`);
      }
    }
  }
}

for (const target of retiredRegionalRuntimeTargets) {
  for (const filePath of collectFiles(target)) {
    const rel = relative(root, filePath);
    const content = readFileSync(filePath, 'utf8');

    for (const rule of retiredRegionalRuntimeSurface) {
      if (rule.pattern.test(content)) {
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
