import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../..');
const ignoredPrefixes = [
  '.git/',
  'node_modules/',
  'output/',
  'apps/probe-rs/target/'
];
const markdownLinkPattern = /!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^)]*["'])?\)/g;
const errors: string[] = [];
let checkedFiles = 0;
const requiredUserGuides = [
  'install',
  'configure',
  'regions',
  'checks',
  'scheduling',
  'browser-audits',
  'artifacts',
  'backup-restore',
  'upgrade',
  'security',
  'troubleshooting',
  'reverse-proxy',
  'cloud-vs-self-hosted'
].map((name) => `docs/users/${name}.md`);
const requiredContributorGuides = [
  'docs/contributors/development.md',
  'docs/contributors/releases.md'
];
const files = Array.fromAsync(
  new Bun.Glob('**/*.md').scan({
    cwd: repositoryRoot,
    dot: true,
    onlyFiles: true
  })
);

for (const relativePath of (await files).sort()) {
  if (ignoredPrefixes.some((prefix) => relativePath.startsWith(prefix))) {
    continue;
  }
  checkedFiles += 1;

  const absolutePath = resolve(repositoryRoot, relativePath);
  let source: string;
  try {
    source = await Bun.file(absolutePath).text();
  } catch {
    errors.push(`${relativePath}: unable to read Markdown file`);
    continue;
  }

  for (const [index, line] of source.split('\n').entries()) {
    if (/\/(?:Users|home)\/[A-Za-z0-9._-]+\//.test(line) || line.includes('file://')) {
      errors.push(`${relativePath}:${index + 1}: local absolute path is not public-safe`);
    }
  }

  for (const match of source.matchAll(markdownLinkPattern)) {
    const rawTarget = match[1].replace(/^<|>$/g, '');
    const target = rawTarget.split('#', 1)[0].split('?', 1)[0];

    if (
      !target
      || target.startsWith('#')
      || target.startsWith('//')
      || /^[a-z][a-z0-9+.-]*:/i.test(target)
    ) {
      continue;
    }

    let decodedTarget: string;
    try {
      decodedTarget = decodeURIComponent(target);
    } catch {
      errors.push(`${relativePath}: invalid percent-encoding in link ${rawTarget}`);
      continue;
    }

    const resolvedTarget = decodedTarget.startsWith('/')
      ? resolve(repositoryRoot, decodedTarget.slice(1))
      : resolve(dirname(absolutePath), decodedTarget);

    if (!existsSync(resolvedTarget)) {
      errors.push(`${relativePath}: broken relative link ${rawTarget}`);
      continue;
    }

    if (decodedTarget.endsWith('/') && !statSync(resolvedTarget).isDirectory()) {
      errors.push(`${relativePath}: link expects a directory ${rawTarget}`);
    }
  }
}

for (const requiredPath of [...requiredUserGuides, ...requiredContributorGuides]) {
  if (!existsSync(resolve(repositoryRoot, requiredPath))) {
    errors.push(`${requiredPath}: required public-beta guide is missing`);
  }
}

let readme = '';
try {
  readme = await Bun.file(resolve(repositoryRoot, 'README.md')).text();
} catch {
  errors.push('README.md: unable to read public entrypoint');
}
const readmeHeadings = [
  '## Screenshots',
  '## Docker quick start',
  '## Core features',
  '## Optional Browser Audit',
  '## Security warning',
  '## Self-hosted and WebPerf Cloud',
  '## Upgrade and backup',
  '## Contributor setup'
];
let previousHeadingIndex = -1;
for (const heading of readmeHeadings) {
  const index = readme.indexOf(heading);
  if (index === -1) {
    errors.push(`README.md: required section is missing: ${heading}`);
  } else if (index <= previousHeadingIndex) {
    errors.push(`README.md: section is out of operator-first order: ${heading}`);
  } else {
    previousHeadingIndex = index;
  }
}
const sourceDevIndex = readme.indexOf('bun run dev');
const contributorIndex = readme.indexOf('## Contributor setup');
if (sourceDevIndex !== -1 && sourceDevIndex < contributorIndex) {
  errors.push('README.md: source development instructions must follow operator guidance');
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, markdownFiles: checkedFiles }));
