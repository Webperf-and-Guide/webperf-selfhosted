import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { releaseImages } from './release-bundle';
import { retiredReleasePaths } from './retired-release-paths';
import {
  containsMutableContainerTag,
  extractWorkflowActionReferences,
  isImmutableActionReference
} from './release-policy';

const root = process.cwd();
const workflowsDirectory = join(root, '.github/workflows');
const violations: string[] = [];
const workflowCache = new Map<string, string | undefined>();

type WorkflowImageEntry = {
  name: string;
  image: string;
};

type WorkflowDocument = {
  jobs?: Record<string, {
    strategy?: {
      matrix?: {
        include?: unknown;
      };
    };
  }>;
};

function readWorkflow(file: string): string | undefined {
  if (workflowCache.has(file)) {
    return workflowCache.get(file);
  }
  try {
    const content = readFileSync(join(workflowsDirectory, file), 'utf8');
    workflowCache.set(file, content);
    return content;
  } catch {
    violations.push(`${file}: workflow file is missing or unreadable`);
    workflowCache.set(file, undefined);
    return undefined;
  }
}

const releaseWorkflow = readWorkflow('release.yml');
const ciWorkflow = readWorkflow('ci.yml');
const releaseImageMatrix = parseImageMatrix(releaseWorkflow, 'release.yml', 'images');
const developmentImageMatrix = parseImageMatrix(
  ciWorkflow,
  'ci.yml',
  'publish-dev-images'
);

let workflowFiles: string[] = [];
try {
  workflowFiles = readdirSync(workflowsDirectory).filter((entry) => /\.ya?ml$/.test(entry));
} catch {
  violations.push('.github/workflows: workflow directory is missing or unreadable');
}

for (const file of workflowFiles) {
  const content = readWorkflow(file);
  if (content === undefined) {
    continue;
  }
  for (const action of extractWorkflowActionReferences(content)) {
    if (!isImmutableActionReference(action)) {
      violations.push(`${file}: external action is not pinned to a full commit SHA: ${action}`);
    }
  }
}

for (const definition of releaseImages) {
  const image = definition.image.split('/').at(-1) ?? '';
  const hasMapping = (entries: WorkflowImageEntry[]) => entries.some(
    (entry) => entry.name === definition.name && entry.image === image
  );
  if (releaseWorkflow !== undefined && !hasMapping(releaseImageMatrix)) {
    violations.push(`release.yml: missing or incorrect image matrix mapping for ${definition.name}`);
  }
  if (ciWorkflow !== undefined && !hasMapping(developmentImageMatrix)) {
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
  if (releaseWorkflow !== undefined && !releaseWorkflow.includes(requiredFragment)) {
    violations.push(`release.yml: missing release invariant ${requiredFragment}`);
  }
}

if (releaseWorkflow !== undefined && containsMutableContainerTag(releaseWorkflow)) {
  violations.push('release.yml: formal releases must not use main or latest image tags');
}
if (
  ciWorkflow !== undefined
  && (!ciWorkflow.includes(':main') || !ciWorkflow.includes(':sha-${{ github.sha }}'))
) {
  violations.push('ci.yml: main-channel publishing must include main and source-SHA tags');
}
if (ciWorkflow !== undefined && ciWorkflow.includes(':latest')) {
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
let schemaLoaded = false;
try {
  schema = JSON.parse(
    readFileSync(join(root, 'infra/release/runtime-metadata.schema.json'), 'utf8')
  );
  schemaLoaded = true;
} catch {
  violations.push('runtime metadata schema is missing, unreadable, or invalid JSON');
}
const schemaNames = schema.properties?.images?.items?.properties?.name?.enum;
const expectedNames = new Set<string>(releaseImages.map(({ name }) => name));
if (
  schemaLoaded
  && (
    !Array.isArray(schemaNames)
    || schemaNames.length !== expectedNames.size
    || schemaNames.some((name) => typeof name !== 'string' || !expectedNames.has(name))
    || new Set(schemaNames).size !== schemaNames.length
  )
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

function parseImageMatrix(
  content: string | undefined,
  file: string,
  jobId: string
): WorkflowImageEntry[] {
  if (content === undefined) {
    return [];
  }

  let document: WorkflowDocument;
  try {
    document = Bun.YAML.parse(content) as WorkflowDocument;
  } catch {
    violations.push(`${file}: workflow YAML is invalid`);
    return [];
  }

  const include = document.jobs?.[jobId]?.strategy?.matrix?.include;
  if (!Array.isArray(include)) {
    violations.push(`${file}: ${jobId} image matrix include list is missing`);
    return [];
  }

  return include.filter(
    (entry): entry is WorkflowImageEntry => (
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
      && typeof (entry as Record<string, unknown>).name === 'string'
      && typeof (entry as Record<string, unknown>).image === 'string'
    )
  );
}
