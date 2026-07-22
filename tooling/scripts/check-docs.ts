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

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, markdownFiles: checkedFiles }));
