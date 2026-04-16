import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const roots = [
  path.resolve('packages/ui/src/lib/components/ui'),
  path.resolve('packages/ui/src/lib/hooks'),
  path.resolve('packages/ui/src/lib/actions')
];

const replacements: Array<[RegExp, string]> = [
  [/from ['"]\$lib\/utils(?:\.js)?['"]/g, "from '@webperf/ui/utils'"],
  [/from ['"]src\/lib\/utils(?:\.js)?['"]/g, "from '@webperf/ui/utils'"],
  [/from ['"]@webperf\/ui\/utils\.js['"]/g, "from '@webperf/ui/utils'"],
  [/from ['"]\$lib\/components\/ui\/([^'"]+)\/index\.js['"]/g, "from '@webperf/ui/components/ui/$1'"],
  [/from ['"]src\/lib\/components\/ui\/([^'"]+)\/index\.js['"]/g, "from '@webperf/ui/components/ui/$1'"],
  [/from ['"]\$lib\/components\/ui\/([^'"]+)['"]/g, "from '@webperf/ui/components/ui/$1'"],
  [/from ['"]src\/lib\/components\/ui\/([^'"]+)['"]/g, "from '@webperf/ui/components/ui/$1'"],
  [/from ['"]\$lib\/hooks\/([^'"]+)['"]/g, "from '@webperf/ui/hooks/$1'"],
  [/from ['"]src\/lib\/hooks\/([^'"]+)['"]/g, "from '@webperf/ui/hooks/$1'"],
  [/from ['"]\.\.\/\.\.\/\.\.\/utils(?:\.js)?['"]/g, "from '@webperf/ui/utils'"],
  [/from ['"]\.\.\/\.\.\/\.\.\/hooks\/use-ramp\.svelte['"]/g, "from '@webperf/ui/hooks/use-ramp'"],
  [/from ['"]\.\.\/\.\.\/\.\.\/hooks\/use-clipboard\.svelte['"]/g, "from '@webperf/ui/hooks/use-clipboard'"],
  [/from ['"]\.\.\/\.\.\/button\.svelte['"]/g, "from '@webperf/ui/components/ui/button'"],
  [/from ['"]\$lib\/actions\/([^'"]+)['"]/g, "from '@webperf/ui/actions/$1'"],
  [/from ['"]src\/lib\/actions\/([^'"]+)['"]/g, "from '@webperf/ui/actions/$1'"]
];

const visit = (dir: string) => {
  if (!existsSync(dir)) {
    return;
  }

  for (const entry of readdirSync(dir)) {
    const target = path.join(dir, entry);
    const stat = statSync(target);

    if (stat.isDirectory()) {
      visit(target);
      continue;
    }

    if (!target.endsWith('.svelte') && !target.endsWith('.ts')) {
      continue;
    }

    const original = readFileSync(target, 'utf8');
    let next = original;

    for (const [pattern, replacement] of replacements) {
      next = next.replace(pattern, replacement);
    }

    if (next !== original) {
      writeFileSync(target, next);
    }
  }
};

for (const root of roots) {
  visit(root);
}
