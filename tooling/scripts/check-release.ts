import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { releaseImages } from './release-bundle';

const root = process.cwd();
const workflowsDirectory = join(root, '.github/workflows');
const releaseWorkflow = readFileSync(join(workflowsDirectory, 'release.yml'), 'utf8');
const ciWorkflow = readFileSync(join(workflowsDirectory, 'ci.yml'), 'utf8');
const violations: string[] = [];

for (const file of readdirSync(workflowsDirectory).filter((entry) => /\.ya?ml$/.test(entry))) {
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
  if (!releaseWorkflow.includes(`- name: ${definition.name}`) || !releaseWorkflow.includes(`image: ${image}`)) {
    violations.push(`release.yml: missing image matrix mapping for ${definition.name}`);
  }
  if (!ciWorkflow.includes(`- name: ${definition.name}`) || !ciWorkflow.includes(`image: ${image}`)) {
    violations.push(`ci.yml: missing main-channel image mapping for ${definition.name}`);
  }
}

for (const requiredFragment of [
  'uses: ./.github/workflows/ci.yml',
  'sbom: true',
  'provenance: mode=max',
  'actions/attest@',
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

for (const retiredPath of [
  '.github/workflows/publish-probe-image.yml',
  '.github/workflows/publish-browser-audit-image.yml',
  'infra/docker/metadata/probe.json',
  'infra/docker/metadata/browser-audit-lighthouse.json',
  'tooling/scripts/bump-image-tag.ts'
]) {
  if (existsSync(join(root, retiredPath))) {
    violations.push(`${retiredPath}: retired mutable image metadata path still exists`);
  }
}

const schema = JSON.parse(
  readFileSync(join(root, 'infra/release/runtime-metadata.schema.json'), 'utf8')
) as {
  properties?: { images?: { items?: { properties?: { name?: { enum?: unknown } } } } };
};
const schemaNames = schema.properties?.images?.items?.properties?.name?.enum;
if (
  !Array.isArray(schemaNames)
  || schemaNames.join('\n') !== releaseImages.map(({ name }) => name).join('\n')
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
