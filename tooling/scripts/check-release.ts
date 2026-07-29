import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  composeEnvironmentVersion,
  isRepositoryReleaseSuccessor,
  releaseImages,
  repositoryReleaseVersion
} from './release-bundle';
import { retiredReleasePaths } from './retired-release-paths';
import {
  containsMutableContainerTag,
  extractWorkflowActionReferences,
  hasExactPermissions,
  isImmutableActionReference,
  parseWorkflowYaml,
  workflowJobPermissions,
  type WorkflowPolicyDocument
} from './release-policy';

const root = process.cwd();
const workflowsDirectory = join(root, '.github/workflows');
const violations: string[] = [];
const workflowCache = new Map<string, string | undefined>();
const workflowDocumentCache = new Map<string, WorkflowPolicyDocument | undefined>();

type WorkflowImageEntry = {
  name: string;
  image: string;
  context: string;
  file: string;
};

type WorkflowBuildEntry = {
  name: string;
  context: string;
  file: string;
  platform: string;
  arch: string;
  runner: string;
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
const releasePrWorkflow = readWorkflow('release-pr.yml');
const ciWorkflow = readWorkflow('ci.yml');
const releaseBundleSmokeWorkflow = readWorkflow('release-bundle-smoke.yml');
let composeSmokeScript: string | undefined;
try {
  composeSmokeScript = readFileSync(join(root, 'tooling/scripts/smoke-compose.sh'), 'utf8');
} catch {
  violations.push('tooling/scripts/smoke-compose.sh: script is missing or unreadable');
}
let releaseTagScript: string | undefined;
try {
  releaseTagScript = readFileSync(join(root, 'tooling/scripts/release-tag.sh'), 'utf8');
} catch {
  violations.push('tooling/scripts/release-tag.sh: script is missing or unreadable');
}
const releaseImageMatrix = parseImageMatrix(releaseWorkflow, 'release.yml', 'images');
const developmentImageMatrix = parseImageMatrix(
  ciWorkflow,
  'ci.yml',
  'publish-dev-images'
);
const ciImageBuildMatrix = parseBuildMatrix(ciWorkflow, 'ci.yml', 'images');
const releaseCiPermissionsResult = parseJobPermissions(
  releaseWorkflow,
  'release.yml',
  'ci'
);

if (releaseCiPermissionsResult.parsed) {
  if (releaseCiPermissionsResult.permissions === undefined) {
    violations.push(
      'release.yml: reusable CI caller must declare permissions with contents: read and packages: write'
    );
  } else if (!hasExactPermissions(releaseCiPermissionsResult.permissions, {
    contents: 'read',
    packages: 'write'
  })) {
    violations.push(
      'release.yml: reusable CI caller must allow exactly contents: read and packages: write'
    );
  }
}

for (const definition of releaseImages) {
  for (const { platform, arch, runner } of [
    { platform: 'linux/amd64', arch: 'amd64', runner: 'ubuntu-latest' },
    { platform: 'linux/arm64', arch: 'arm64', runner: 'ubuntu-24.04-arm' }
  ]) {
    if (!ciImageBuildMatrix.some(
      (entry) => entry.name === definition.name
        && entry.platform === platform
        && entry.arch === arch
        && entry.runner === runner
        && entry.context === definition.context
        && entry.file === definition.file
    )) {
      violations.push(
        `ci.yml: ${definition.name} image matrix must build ${definition.file} from ${definition.context} on the native ${arch} runner`
      );
    }
  }
}

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
    (entry) => entry.name === definition.name
      && entry.image === image
      && entry.context === definition.context
      && entry.file === definition.file
  );
  if (releaseWorkflow !== undefined && !hasMapping(releaseImageMatrix)) {
    violations.push(`release.yml: missing or incorrect image matrix mapping for ${definition.name}`);
  }
  if (ciWorkflow !== undefined && !hasMapping(developmentImageMatrix)) {
    violations.push(`ci.yml: missing or incorrect main-channel image mapping for ${definition.name}`);
  }
}

for (const [file, workflow] of [
  ['ci.yml', ciWorkflow],
  ['release.yml', releaseWorkflow]
] as const) {
  if (workflow === undefined) {
    continue;
  }
  if (!workflow.includes('docker/setup-qemu-action@')) {
    violations.push(`${file}: multi-platform publishing must set up arm64 emulation`);
  }
  if (!/image:\s+(?:docker\.io\/)?tonistiigi\/binfmt@sha256:[a-f0-9]{64}/.test(workflow)) {
    violations.push(`${file}: QEMU binfmt image must be pinned by digest`);
  }
  if (!workflow.includes('platforms: linux/amd64,linux/arm64')) {
    violations.push(`${file}: runtime publishing must target linux/amd64 and linux/arm64`);
  }
}

assertCacheScopes('ci.yml', ciWorkflow, [
  'scope=ci-${{ matrix.name }}-amd64',
  'scope=ci-${{ matrix.name }}-arm64',
  'scope=ci-${{ matrix.name }}-publish'
]);

assertCacheScopes('release.yml', releaseWorkflow, [
  'scope=ci-${{ matrix.name }}-amd64',
  'scope=ci-${{ matrix.name }}-arm64',
  'scope=release-${{ matrix.name }}'
]);

for (const requiredFragment of [
  'workflow_dispatch:',
  'uses: ./.github/workflows/ci.yml',
  'source_sha:',
  'run-name: release ${{',
  "ref: ${{ github.event_name == 'workflow_dispatch' && inputs.source_sha || github.ref }}",
  'source_sha: ${{ needs.prepare.outputs.source_sha }}',
  'git rev-list --first-parent refs/remotes/origin/main',
  'Release source must be the main commit that changed VERSION.',
  'sbom: true',
  'provenance: mode=max',
  'actions/attest@',
  'environment: release',
  'Resolve published OCI platform manifests',
  'id: platform-digests',
  'docker buildx imagetools inspect --raw',
  'steps.platform-digests.outputs.linux_amd64_digest',
  'steps.platform-digests.outputs.linux_arm64_digest',
  'output-file: release-output/${{ matrix.name }}-${{ needs.prepare.outputs.version }}.spdx.json',
  '-linux-arm64.spdx.json',
  'browser-audit.apparmor',
  'browser-audit-seccomp.json',
  'compose.apparmor.yml',
  'runtime-metadata.json',
  'SHA256SUMS',
  'uses: ./.github/workflows/release-bundle-smoke.yml',
  'needs: [prepare, bundle]'
]) {
  if (releaseWorkflow !== undefined && !releaseWorkflow.includes(requiredFragment)) {
    violations.push(`release.yml: missing release invariant ${requiredFragment}`);
  }
}

for (const requiredFragment of [
  'openssl rand -base64 32',
  'SMOKE_ADMIN_TOKEN="$smoke_admin_token"',
  'SMOKE_INTERNAL_SECRET="$smoke_internal_secret"',
  'SMOKE_PROBE_SECRET="$smoke_probe_secret"',
  'SMOKE_BROWSER_AUDIT_SECRET="$smoke_browser_audit_secret"',
  'smoke_admin_token="$(generate_smoke_secret)" || exit 1',
  'smoke_internal_secret="$(generate_smoke_secret)" || exit 1',
  'smoke_probe_secret="$(generate_smoke_secret)" || exit 1',
  'smoke_browser_audit_secret="$(generate_smoke_secret)" || exit 1',
  '-H "authorization: Bearer ${smoke_admin_token}"'
]) {
  if (composeSmokeScript !== undefined && !composeSmokeScript.includes(requiredFragment)) {
    violations.push(`smoke-compose.sh: missing generated-secret invariant ${requiredFragment}`);
  }
}
for (const fixedCredential of [
  'smoke-admin-token-value',
  'smoke-internal-secret-value',
  'smoke-probe-shared-secret',
  'smoke-browser-audit-shared-secret'
]) {
  if (composeSmokeScript?.includes(fixedCredential)) {
    violations.push(`smoke-compose.sh: fixed smoke credential must not remain (${fixedCredential})`);
  }
}

for (const requiredFragment of [
  'workflow_call:',
  'workflow_dispatch:',
  'version:',
  'source_sha:',
  'Check out smoke harness',
  'ref: ${{ github.sha }}',
  'Check out release source for metadata verification',
  "ref: ${{ inputs.source_sha || format('v{0}', inputs.version) }}",
  'path: release-source',
  'RELEASE_SOURCE_DIRECTORY: ${{ github.workspace }}/release-source',
  'git -C "$RELEASE_SOURCE_DIRECTORY" rev-parse HEAD',
  '.sourceCommit == $source_sha',
  'validate-version "$VERSION"',
  'curl -q --fail --silent --show-error --location',
  '--retry 15',
  '--retry-all-errors',
  '--retry-max-time 45',
  '--connect-timeout 10',
  '--max-time 20',
  'sha256sum --check SHA256SUMS',
  'WEBPERF_SMOKE_USE_DEV_OVERRIDE: \'false\'',
  'WEBPERF_SMOKE_DOCKER_CONFIG:',
  'test ! -e "$WEBPERF_SMOKE_DOCKER_CONFIG/config.json"',
  'browser-audit.apparmor',
  'BUNDLE_DIR: ${{ steps.bundle.outputs.directory }}',
  'COMPOSE_PROFILE: ${{ matrix.compose_profile }}'
]) {
  if (releaseBundleSmokeWorkflow !== undefined && !releaseBundleSmokeWorkflow.includes(requiredFragment)) {
    violations.push(`release-bundle-smoke.yml: missing published-bundle smoke invariant ${requiredFragment}`);
  }
}

for (const requiredFragment of [
  'workflow_dispatch:',
  'actions: write',
  'contents: write',
  'pull-requests: write',
  'Require main release preparation',
  "refs/heads/main",
  "'.github/workflows/release-pr.yml'",
  'infra/docker-compose/.env.example',
  'SAMPO_RELEASE_BRANCH: main',
  'prepare-release-pull-request',
  'render-release-pull-request',
  'bun run sampo:release',
  'bun install --lockfile-only',
  'peter-evans/create-pull-request@',
  'branch: release/sampo',
  'title: ${{ steps.release_pr_metadata.outputs.title }}',
  'body-path: ${{ steps.release_pr_metadata.outputs.body_path }}',
  "'tooling/scripts/release-bundle.ts'",
  'gh run list',
  'RELEASE_RUN_TITLE',
  'gh workflow run ci.yml --ref',
  'repository-version',
  'source_sha="$(git rev-list --first-parent -1 HEAD -- VERSION)"',
  'if git diff --quiet "${source_sha}^1" "$source_sha" -- VERSION; then',
  'gh workflow run release.yml --ref main',
  '-f "source_sha=${SOURCE_SHA}"'
]) {
  if (releasePrWorkflow !== undefined && !releasePrWorkflow.includes(requiredFragment)) {
    violations.push(`release-pr.yml: missing release preparation invariant ${requiredFragment}`);
  }
}
if (releasePrWorkflow !== undefined && releasePrWorkflow.includes('sampo:publish')) {
  violations.push('release-pr.yml: container release preparation must not publish npm packages');
}
if (releasePrWorkflow !== undefined) {
  const reconcileIndex = releasePrWorkflow.indexOf('Resolve current repository release');
  const changesetIndex = releasePrWorkflow.indexOf('Detect pending Sampo changesets');
  if (
    reconcileIndex === -1
    || changesetIndex === -1
    || reconcileIndex >= changesetIndex
  ) {
    violations.push(
      'release-pr.yml: the current repository release must be reconciled before newer changesets'
    );
  }
}

for (const requiredFragment of [
  'Publish immutable release tag',
  'release-tag.sh verify',
  'publish "$RELEASE_TAG" "$SOURCE_SHA" "$VERSION"',
  'source_sha',
  'ref: ${{ needs.prepare.outputs.source_sha }}',
  'RELEASE_TAG: ${{ needs.prepare.outputs.tag }}'
]) {
  if (releaseWorkflow !== undefined && !releaseWorkflow.includes(requiredFragment)) {
    violations.push(`release.yml: missing dispatch release invariant ${requiredFragment}`);
  }
}

for (const requiredFragment of [
  'workflow_call:',
  'source_sha:',
  'ref: ${{ inputs.source_sha || github.sha }}'
]) {
  if (ciWorkflow !== undefined && !ciWorkflow.includes(requiredFragment)) {
    violations.push(`ci.yml: missing source-pinned reusable CI invariant ${requiredFragment}`);
  }
}
if (ciWorkflow !== undefined) {
  const checkoutCount = ciWorkflow.match(/uses: actions\/checkout@/g)?.length ?? 0;
  const sourcePinnedCheckoutCount = ciWorkflow
    .match(/ref: \$\{\{ inputs\.source_sha \|\| github\.sha \}\}/g)?.length ?? 0;
  if (checkoutCount === 0 || checkoutCount !== sourcePinnedCheckoutCount) {
    violations.push('ci.yml: every checkout must honor the reusable source_sha input');
  }
}

try {
  const repositoryVersion = repositoryReleaseVersion(root);
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  const latestChangelogVersion = changelog.match(/^## \[([^\]]+)\]/m)?.[1];
  const latestReleaseEntry = changelog
    .slice(changelog.search(/^## \[/m))
    .split(/\n(?=## \[)/, 1)[0];
  const preparedFromVersion = latestReleaseEntry.match(
    /^<!-- webperf-release: from=(\S+); changesets=sha256:[a-f0-9]{64} -->$/m
  )?.[1];
  const recoverablePreparation = (
    preparedFromVersion === repositoryVersion
    && latestChangelogVersion !== undefined
    && isRepositoryReleaseSuccessor(repositoryVersion, latestChangelogVersion)
  );
  if (latestChangelogVersion !== repositoryVersion && !recoverablePreparation) {
    violations.push(
      `CHANGELOG.md: latest entry ${latestChangelogVersion ?? '(unreadable)'} does not match repository VERSION ${repositoryVersion}`
    );
  }
  const composeVersion = composeEnvironmentVersion(
    readFileSync(join(root, 'infra/docker-compose/.env.example'), 'utf8')
  );
  const regionalVersion = composeEnvironmentVersion(
    readFileSync(join(root, 'infra/regional-runtime/.env.example'), 'utf8')
  );
  for (const [path, version] of [
    ['infra/docker-compose/.env.example', composeVersion],
    ['infra/regional-runtime/.env.example', regionalVersion]
  ] as const) {
    if (
      version !== repositoryVersion
      && !(recoverablePreparation && version === latestChangelogVersion)
    ) {
      violations.push(
        `${path}: WEBPERF_VERSION ${version} does not match repository release state`
      );
    }
  }
} catch (error) {
  violations.push(
    `repository release state: ${error instanceof Error ? error.message : 'release metadata is unreadable'}`
  );
}

for (const requiredFragment of [
  'bun "$validator" validate-version "$version"',
  'verify_remote_tag',
  'git ls-remote --exit-code --tags origin "$tag_ref" "${tag_ref}^{}"',
  'Existing release tag must be annotated.',
  'git tag -a -f "$tag" "$source_sha"',
  'if git push origin "$tag_ref"; then',
  'A concurrent release may have won the push race.'
]) {
  if (releaseTagScript !== undefined && !releaseTagScript.includes(requiredFragment)) {
    violations.push(`release-tag.sh: missing immutable-tag invariant ${requiredFragment}`);
  }
}

if (releaseWorkflow !== undefined && containsMutableContainerTag(releaseWorkflow)) {
  violations.push('release.yml: formal releases must not use main or latest image tags');
}
if (
  releaseBundleSmokeWorkflow !== undefined
  && containsMutableContainerTag(releaseBundleSmokeWorkflow)
) {
  violations.push('release-bundle-smoke.yml: published bundle smoke must not use main or latest image tags');
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
for (const requiredFragment of [
  'workflow_dispatch:',
  'runs-on: ${{ matrix.runner }}',
  'platforms: ${{ matrix.platform }}'
]) {
  if (ciWorkflow !== undefined && !ciWorkflow.includes(requiredFragment)) {
    violations.push(`ci.yml: missing arm64 build invariant ${requiredFragment}`);
  }
}

try {
  const rootManifest = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8')
  ) as { devDependencies?: Record<string, unknown> };
  const sampoVersion = rootManifest.devDependencies?.sampo;
  if (
    typeof sampoVersion !== 'string'
    || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(sampoVersion)
  ) {
    violations.push('package.json: Sampo must be an exact pinned development dependency');
  }
} catch {
  violations.push('package.json: root manifest is missing, unreadable, or malformed');
}

try {
  const browserAuditDockerfile = readFileSync(
    join(root, 'apps/browser-audit-lighthouse/Dockerfile'),
    'utf8'
  );
  const chromeVersion = browserAuditDockerfile.match(/^ARG CHROME_VERSION=(\S+)$/m)?.[1];
  const debianChromiumVersion = browserAuditDockerfile
    .match(/^ARG DEBIAN_CHROMIUM_VERSION=(\S+)$/m)?.[1];
  const debianSnapshot = browserAuditDockerfile
    .match(/^ARG DEBIAN_CHROMIUM_SNAPSHOT=(\d{8}T\d{6}Z)$/m)?.[1];
  const debianSnapshotSourceDefinition = `printf 'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/%s/ trixie main\\ndeb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/%s/ trixie-security main\\n' "$DEBIAN_CHROMIUM_SNAPSHOT" "$DEBIAN_CHROMIUM_SNAPSHOT" > /tmp/chromium-snapshot.list`;
  const debianSnapshotPreferenceDefinition = `printf 'Package: *\\nPin: origin "snapshot.debian.org"\\nPin-Priority: 100\\n\\nPackage: chromium chromium-common chromium-sandbox\\nPin: version %s\\nPin-Priority: 1001\\n' "$DEBIAN_CHROMIUM_VERSION" > /tmp/chromium-snapshot.pref`;
  const debianSnapshotSourceDefinitionCount = browserAuditDockerfile
    .split(debianSnapshotSourceDefinition).length - 1;
  const debianSnapshotSourceUseCount = browserAuditDockerfile
    .match(/Dir::Etc::sourcelist=\/tmp\/chromium-snapshot\.list/g)?.length ?? 0;
  let puppeteerChromeVersion: string | undefined;
  try {
    const puppeteerModulePath = Bun.resolveSync(
      'puppeteer-core',
      join(root, 'apps/browser-audit-lighthouse/src')
    );
    const puppeteerModule = await import(puppeteerModulePath) as {
      PUPPETEER_REVISIONS?: { chrome?: unknown };
    };
    const candidate = puppeteerModule.PUPPETEER_REVISIONS?.chrome;
    puppeteerChromeVersion = typeof candidate === 'string' ? candidate : undefined;
  } catch {
    violations.push(
      'browser-audit-lighthouse: locked puppeteer-core Chrome revision is unreadable'
    );
  }

  if (
    !chromeVersion
    || debianChromiumVersion !== `${chromeVersion}-1~deb13u1`
  ) {
    violations.push(
      'browser-audit-lighthouse Dockerfile: arm64 Debian Chromium must match CHROME_VERSION exactly'
    );
  }
  if (!puppeteerChromeVersion || chromeVersion !== puppeteerChromeVersion) {
    violations.push(
      'browser-audit-lighthouse Dockerfile: CHROME_VERSION must match locked puppeteer-core'
    );
  }
  if (
    !debianSnapshot
    || debianSnapshotSourceDefinitionCount !== 1
    || debianSnapshotSourceUseCount < 5
    || !browserAuditDockerfile.includes(debianSnapshotPreferenceDefinition)
    || !browserAuditDockerfile.includes('Dir::Etc::preferences=/tmp/chromium-snapshot.pref')
    || !browserAuditDockerfile.includes('for package in chromium chromium-common chromium-sandbox')
    || !browserAuditDockerfile.includes('Dir::Etc::sourceparts=-')
    || !browserAuditDockerfile.includes('/tmp/chromium-debs/*.deb')
    || !browserAuditDockerfile.includes('dpkg --unpack /tmp/chromium-debs/*.deb')
    || !browserAuditDockerfile.includes("dpkg-query -W -f='${Version}'")
    || browserAuditDockerfile.includes('allow-downgrades')
    || !browserAuditDockerfile.includes('"chromium=$DEBIAN_CHROMIUM_VERSION"')
    || !browserAuditDockerfile.includes('"chromium-common=$DEBIAN_CHROMIUM_VERSION"')
    || !browserAuditDockerfile.includes('"chromium-sandbox=$DEBIAN_CHROMIUM_VERSION"')
  ) {
    violations.push(
      'browser-audit-lighthouse Dockerfile: arm64 browser packages must use pinned Debian snapshots without downgrading current runtime libraries'
    );
  }
  if (
    browserAuditDockerfile.includes('chmod 4755')
    || browserAuditDockerfile.includes('ENV CHROME_DEVEL_SANDBOX=')
    || !browserAuditDockerfile.includes('test ! -u /opt/webperf/chrome/chrome-sandbox')
  ) {
    violations.push(
      'browser-audit-lighthouse Dockerfile: packaged sandbox helpers must remain non-setuid'
    );
  }
  if (
    !browserAuditDockerfile.includes('ENV CHROME_INSTALL_DIR=/opt/webperf/chrome')
    || browserAuditDockerfile.includes('/opt/google/chrome')
  ) {
    violations.push(
      'browser-audit-lighthouse Dockerfile: Chrome must use the product-specific path to avoid host AppArmor profile collisions'
    );
  }
} catch {
  violations.push('browser-audit-lighthouse Dockerfile is missing or unreadable');
}

try {
  const browserAuditSource = readFileSync(
    join(root, 'apps/browser-audit-lighthouse/src/audit.ts'),
    'utf8'
  );
  if (!browserAuditSource.includes("'--disable-setuid-sandbox'")) {
    violations.push(
      'browser-audit-lighthouse: the user-namespace sandbox launch policy is missing'
    );
  }
} catch {
  violations.push('browser-audit-lighthouse launch policy is missing or unreadable');
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

function assertCacheScopes(
  file: string,
  workflow: string | undefined,
  fragments: readonly string[]
) {
  if (workflow === undefined) {
    return;
  }
  for (const requiredFragment of fragments) {
    if (!workflow.includes(requiredFragment)) {
      violations.push(`${file}: multi-platform cache scope is missing ${requiredFragment}`);
    }
  }
}

function parseImageMatrix(
  content: string | undefined,
  file: string,
  jobId: string
): WorkflowImageEntry[] {
  return parseMatrixInclude(content, file, jobId).filter(
    (entry): entry is WorkflowImageEntry => (
      typeof entry.name === 'string'
      && typeof entry.image === 'string'
      && typeof entry.context === 'string'
      && typeof entry.file === 'string'
    )
  );
}

function parseBuildMatrix(
  content: string | undefined,
  file: string,
  jobId: string
): WorkflowBuildEntry[] {
  return parseMatrixInclude(content, file, jobId).filter(
    (entry): entry is WorkflowBuildEntry => (
      typeof entry.name === 'string'
      && typeof entry.context === 'string'
      && typeof entry.file === 'string'
      && typeof entry.platform === 'string'
      && typeof entry.arch === 'string'
      && typeof entry.runner === 'string'
    )
  );
}

function parseJobPermissions(
  content: string | undefined,
  file: string,
  jobId: string
):
  | { parsed: false }
  | { parsed: true; permissions: unknown } {
  const document = parseWorkflowDocument(content, file);
  if (document === undefined) {
    return { parsed: false };
  }

  return {
    parsed: true,
    permissions: workflowJobPermissions(document, jobId)
  };
}

function parseMatrixInclude(
  content: string | undefined,
  file: string,
  jobId: string
): Record<string, unknown>[] {
  const document = parseWorkflowDocument(content, file);
  if (document === undefined) {
    return [];
  }

  const include = document.jobs?.[jobId]?.strategy?.matrix?.include;
  if (!Array.isArray(include)) {
    violations.push(`${file}: ${jobId} matrix include list is missing`);
    return [];
  }

  return include.filter(
    (entry): entry is Record<string, unknown> => (
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
    )
  );
}

function parseWorkflowDocument(
  content: string | undefined,
  file: string
): WorkflowPolicyDocument | undefined {
  if (workflowDocumentCache.has(file)) {
    return workflowDocumentCache.get(file);
  }
  if (content === undefined) {
    workflowDocumentCache.set(file, undefined);
    return undefined;
  }

  const parsed = parseWorkflowYaml(content);
  if (!parsed.ok) {
    violations.push(
      `${file}: workflow YAML is ${
        parsed.reason === 'invalid_yaml' ? 'invalid' : 'not a valid mapping'
      }`
    );
    workflowDocumentCache.set(file, undefined);
    return undefined;
  }

  workflowDocumentCache.set(file, parsed.document);
  return parsed.document;
}
