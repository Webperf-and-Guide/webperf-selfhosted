import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

type Rule = {
  name: string;
  targets: string[];
  banned: Array<{
    pattern: RegExp;
    message: string;
  }>;
};

const root = process.cwd();
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.svelte']);
const ignoredDirectories = new Set([
  'node_modules',
  '.git',
  '.turbo',
  '.wrangler',
  '.svelte-kit',
  'dist',
  'build',
  'coverage',
  'output'
]);

const rules: Rule[] = [
  {
    name: 'public-safe modules must not depend on cloud-only entrypoints',
    targets: [
      'apps/console/src',
      'apps/api/src',
      'apps/scheduler/src',
      'packages/contracts/src',
      'packages/domain-core/src',
      'packages/report-core/src',
      'packages/ui/src'
    ],
    banned: [
      {
        pattern: /^@webperf\/shared$/,
        message: 'use @webperf/shared/public or a narrower subpath instead of the mixed root export'
      },
      {
        pattern: /^@webperf\/shared\/cloud$/,
        message: 'cloud-only shared helpers must stay out of public-safe modules'
      },
      {
        pattern: /^@webperf\/shared\/feature-flags$/,
        message: 'feature flags are cloud-only'
      },
      {
        pattern: /^@webperf\/shared\/pricing-policy$/,
        message: 'pricing policy is cloud-only'
      },
      {
        pattern: /^@webperf\/shared\/constants\/pricing$/,
        message: 'pricing constants are cloud-only'
      },
      {
        pattern: /^@webperf\/config$/,
        message:
          'use @webperf/config/public, @webperf/config/selfhost, or @webperf/config/selfhost-scheduler instead of the mixed root export'
      },
      {
        pattern: /^@webperf\/config\/cloud$/,
        message: 'cloud env parsing must stay out of public-safe modules'
      },
      {
        pattern: /^@webperf\/billing(?:\/|$)/,
        message: 'billing modules are private-cloud only'
      },
      {
        pattern: /^@webperf\/tenanting(?:\/|$)/,
        message: 'tenanting modules are private-cloud only'
      },
      {
        pattern: /^@webperf\/managed-runners(?:\/|$)/,
        message: 'managed runner implementations must stay out of public-safe modules'
      },
      {
        pattern: /^@webperf\/managed-alerts(?:\/|$)/,
        message: 'named alert integrations are managed-only'
      },
      {
        pattern: /packages\/(?:billing|tenanting|managed-runners|managed-alerts)\//,
        message: 'public-safe modules must not import private package implementations directly'
      },
      {
        pattern: /apps\/edge-control\//,
        message: 'public-safe modules must not import private cloud app code directly'
      }
    ]
  },
  {
    name: 'public/selfhost env entrypoints must stay isolated from cloud parsing',
    targets: [
      'packages/config/src/public.ts',
      'packages/config/src/selfhost.ts',
      'packages/config/src/selfhost-scheduler.ts'
    ],
    banned: [
      {
        pattern: /^\.\/cloud$/,
        message: 'public or selfhost env entrypoints cannot import cloud parser internals'
      },
      {
        pattern: /^@webperf\/config\/cloud$/,
        message: 'public or selfhost env entrypoints cannot import cloud parser internals'
      }
    ]
  },
  {
    name: 'retired topology names must not come back',
    targets: ['package.json', 'README.md', 'AGENTS.md', 'tooling', 'apps', 'packages', 'docs', 'infra'],
    banned: [
      {
        pattern: /apps\/control\//,
        message: 'use apps/api instead of the retired apps/control path'
      },
      {
        pattern: /packages\/env-schema\//,
        message: 'use packages/config instead of the retired packages/env-schema path'
      },
      {
        pattern: /packages\/report-engine\//,
        message: 'use packages/report-core instead of the retired packages/report-engine path'
      },
      {
        pattern: /infra\/compose\//,
        message: 'use infra/docker-compose instead of the retired infra/compose path'
      }
    ]
  }
];

const importPattern =
  /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

const collectFiles = (target: string): string[] => {
  const absoluteTarget = join(root, target);
  const stats = statSync(absoluteTarget);

  if (stats.isFile()) {
    return [absoluteTarget];
  }

  const output: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) {
          continue;
        }

        walk(join(current, entry.name));
        continue;
      }

      if (!sourceExtensions.has(extname(entry.name))) {
        continue;
      }

      output.push(join(current, entry.name));
    }
  };

  walk(absoluteTarget);
  return output;
};

const readModuleSpecifiers = (filePath: string) => {
  const content = readFileSync(filePath, 'utf8');
  const specifiers: string[] = [];

  for (const match of content.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];

    if (specifier) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
};

const violations: string[] = [];

for (const rule of rules) {
  const files = rule.targets.flatMap(collectFiles);

  for (const filePath of files) {
    const specifiers = readModuleSpecifiers(filePath);

    for (const specifier of specifiers) {
      for (const banned of rule.banned) {
        if (banned.pattern.test(specifier)) {
          violations.push(
            `${relative(root, filePath)} -> ${specifier}: ${banned.message} (${rule.name})`
          );
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Boundary check failed:\n');

  for (const violation of violations) {
    console.error(`- ${violation}`);
  }

  process.exit(1);
}

console.log('Boundary check passed.');
