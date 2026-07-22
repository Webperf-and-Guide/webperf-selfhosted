import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { releaseImages } from './release-bundle';
import { retiredReleasePaths } from './retired-release-paths';

const root = process.cwd();
const workflowsDirectory = join(root, '.github/workflows');
const violations: string[] = [];

function readWorkflow(file: string) {
  try {
    return readFileSync(join(workflowsDirectory, file), 'utf8');
  } catch {
    violations.push(`${file}: required workflow file is missing or unreadable`);
    return '';
  }
}

const releaseWorkflow = readWorkflow('release.yml');
const ciWorkflow = readWorkflow('ci.yml');

let workflowFiles: string[] = [];
try {
  workflowFiles = readdirSync(workflowsDirectory).filter((entry) => /\.ya?ml$/.test(entry));
} catch {
  violations.push('.github/workflows: workflow directory is missing or unreadable');
}

for (const file of workflowFiles) {
  const content = readFileSync(join(workflowsDirectory, file), 'utf8');
  for (const match of content.matchAll(/^\s*uses:\s+([^\s#]+)(?:\s+#.*)?$/gm)) {
    const action = match[1];
    if (action.startsWith('./')) {
      continue;
    }
    const separator = action.lastIndexOf('@');
    const ref = separator === -1 ? '' : action.slice(separator + 1);
    if (!/^[a-f0-9]{40}$/.test(ref)) {
      violations.push(`${file}: external action is not pinned to a full commit SHA: ${action}`);
    }
  }
}

for (const definition of releaseImages) {
  const image = definition.image.split('/').at(-1);
  const mapping = new RegExp(
    `^\\s*- name: ${escapeRegExp(definition.name)}\\s*\\n\\s+image: ${escapeRegExp(image ?? '')}\\s*$`,
    'm'
  );
  if (!mapping.test(releaseWorkflow)) {
    violations.push(`release.yml: missing or incorrect image matrix mapping for ${definition.name}`);
  }
  if (!mapping.test(ciWorkflow)) {
    violations.push(`ci.yml: missing or incorrect main-channel image mapping for ${definition.name}`);
  }
}

for (const requiredFragment of [
  'uses: ./.github/workflows/ci.yml',
  'sbom: true',
  'provenance: mode=max',
  'actions/attest@',
  'environment: release',
  'runtime-metadata.json',
  'SHA256SUMS'
]) {
  if (!releaseWorkflow.includes(requiredFragment)) {
    violations.push(`release.yml: missing release invariant ${requiredFragment}`);
  }
}

if (/ghcr\.io\/[^\s"']+:(?:main|latest)\b/.test(releaseWorkflow)) {
  violations.push('release.yml: formal releases must not use main or latest image tags');
}
if (!ciWorkflow.includes(':main') || !ciWorkflow.includes(':sha-${{ github.sha }}')) {
  violations.push('ci.yml: main-channel publishing must include main and source-SHA tags');
}
if (ciWorkflow.includes(':latest')) {
  violations.push('ci.yml: the mutable latest tag is not part of the development channel');
}

for (const { path: retiredPath } of retiredReleasePaths) {
  if (existsSync(join(root, retiredPath))) {
    violations.push(`${retiredPath}: retired mutable image metadata path still exists`);
  }
}

let schema: {
  properties?: { images?: { items?: { properties?: { name?: { enum?: unknown } } } } };
} = {};
try {
  schema = JSON.parse(
    readFileSync(join(root, 'infra/release/runtime-metadata.schema.json'), 'utf8')
  );
} catch {
  violations.push('runtime metadata schema is missing, unreadable, or invalid JSON');
}
const schemaNames = schema.properties?.images?.items?.properties?.name?.enum;
const expectedNames = new Set<string>(releaseImages.map(({ name }) => name));
if (
  !Array.isArray(schemaNames)
  || schemaNames.length !== expectedNames.size
  || schemaNames.some((name) => typeof name !== 'string' || !expectedNames.has(name))
  || new Set(schemaNames).size !== schemaNames.length
) {
  violations.push('runtime metadata schema image names do not match the release image registry');
}

if (violations.length > 0) {
  console.error('Release policy check failed:\n');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Release policy check passed.');

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
