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
const referenceDefinitionPattern = /^\s{0,3}\[([^\]^][^\]]*)\]:\s*(<[^>\n]+>|[^\s\n]+)(?:\s+.*)?$/gm;
const referenceLinkPattern = /!?\[([^\]\n]+)\]\[([^\]\n]*)\]/g;
const shortcutReferencePattern = /!?\[([^\]\n]+)\](?![\[(])/g;
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
    if (
      /\/(?:Users|home)\/[A-Za-z0-9._-]+\//.test(line)
      || /\b[A-Za-z]:\\(?:Users|home|Windows|Program Files)\\/i.test(line)
      || line.includes('file://')
    ) {
      errors.push(`${relativePath}:${index + 1}: local absolute path is not public-safe`);
    }
  }

  const referenceDefinitions = new Map<string, string>();
  const validatedReferenceLabels = new Set<string>();
  for (const match of source.matchAll(referenceDefinitionPattern)) {
    const label = normalizeReferenceLabel(match[1]);
    const rawTarget = match[2];
    referenceDefinitions.set(label, rawTarget);
  }

  for (const match of source.matchAll(referenceLinkPattern)) {
    const label = normalizeReferenceLabel(match[2] || match[1]);
    if (!referenceDefinitions.has(label)) {
      errors.push(`${relativePath}: unresolved reference-style link [${match[2] || match[1]}]`);
    } else {
      validateReferenceDefinition(
        label,
        referenceDefinitions,
        validatedReferenceLabels,
        relativePath,
        absolutePath
      );
    }
  }

  // A CommonMark shortcut reference is a link only when a matching definition
  // exists; otherwise it is ordinary bracketed text. Resolve the defined forms
  // here while leaving ordinary prose such as `[main]` untouched.
  const sourceWithoutCode = source
    .replace(/(`{3,}|~{3,})[\s\S]*?\1/g, '')
    .replace(/(`+)[^`\n]*?\1/g, '');
  for (const match of sourceWithoutCode.matchAll(shortcutReferencePattern)) {
    const matchIndex = match.index ?? 0;
    const previousCharacter = source[matchIndex - 1];
    const nextCharacter = source[matchIndex + match[0].length];
    if (previousCharacter === ']' || nextCharacter === ':') {
      continue;
    }

    const label = normalizeReferenceLabel(match[1]);
    if (referenceDefinitions.has(label)) {
      validateReferenceDefinition(
        label,
        referenceDefinitions,
        validatedReferenceLabels,
        relativePath,
        absolutePath
      );
    }
  }

  for (const label of referenceDefinitions.keys()) {
    validateReferenceDefinition(
      label,
      referenceDefinitions,
      validatedReferenceLabels,
      relativePath,
      absolutePath
    );
  }

  for (const match of source.matchAll(markdownLinkPattern)) {
    validateLocalLinkTarget(match[1], relativePath, absolutePath);
  }
}

for (const requiredPath of [...requiredUserGuides, ...requiredContributorGuides]) {
  if (!existsSync(resolve(repositoryRoot, requiredPath))) {
    errors.push(`${requiredPath}: required guide is missing`);
  }
}

let readme = '';
try {
  readme = await Bun.file(resolve(repositoryRoot, 'README.md')).text();
} catch {
  errors.push('README.md: unable to read entrypoint');
}
const readmeLines = readme.split(/\r?\n/);
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
let previousHeadingLine = -1;
for (const heading of readmeHeadings) {
  const line = readmeLines.findIndex((candidate) => candidate.trimEnd() === heading);
  if (line === -1) {
    errors.push(`README.md: required section is missing: ${heading}`);
    continue;
  }
  if (line <= previousHeadingLine) {
    errors.push(`README.md: section is out of operator-first order: ${heading}`);
  } else {
    previousHeadingLine = line;
  }
}
const sourceDevLine = readmeLines.findIndex((line) => line.includes('bun run dev'));
const contributorLine = readmeLines.findIndex(
  (line) => line.trimEnd() === '## Contributor setup'
);
if (sourceDevLine !== -1 && contributorLine !== -1 && sourceDevLine < contributorLine) {
  errors.push('README.md: source development instructions must follow operator guidance');
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, markdownFiles: checkedFiles }));

function normalizeReferenceLabel(value: string) {
  return value.trim().replaceAll(/\s+/g, ' ').toLowerCase();
}

function validateLocalLinkTarget(
  rawValue: string,
  sourcePath: string,
  sourceAbsolutePath: string
) {
  const rawTarget = rawValue.replace(/^<|>$/g, '');
  const withoutFragment = rawTarget.split('#', 1).at(0) ?? '';
  const target = withoutFragment.split('?', 1).at(0) ?? '';

  if (
    !target
    || target.startsWith('#')
    || target.startsWith('//')
    || /^[a-z][a-z0-9+.-]*:/i.test(target)
  ) {
    return;
  }

  let decodedTarget: string;
  try {
    decodedTarget = decodeURIComponent(target);
  } catch {
    errors.push(`${sourcePath}: invalid percent-encoding in link ${rawTarget}`);
    return;
  }

  const resolvedTarget = decodedTarget.startsWith('/')
    ? resolve(repositoryRoot, decodedTarget.slice(1))
    : resolve(dirname(sourceAbsolutePath), decodedTarget);

  if (!existsSync(resolvedTarget)) {
    errors.push(`${sourcePath}: broken relative link ${rawTarget}`);
    return;
  }

  if (decodedTarget.endsWith('/') && !statSync(resolvedTarget).isDirectory()) {
    errors.push(`${sourcePath}: link expects a directory ${rawTarget}`);
  }
}

function validateReferenceDefinition(
  label: string,
  definitions: ReadonlyMap<string, string>,
  validatedLabels: Set<string>,
  sourcePath: string,
  sourceAbsolutePath: string
) {
  if (validatedLabels.has(label)) {
    return;
  }

  const target = definitions.get(label);
  if (target === undefined) {
    return;
  }

  validatedLabels.add(label);
  validateLocalLinkTarget(target, sourcePath, sourceAbsolutePath);
}
