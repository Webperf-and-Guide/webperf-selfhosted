import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

export const releaseImages = [
  {
    name: 'webperf',
    image: 'ghcr.io/webperf-and-guide/webperf',
    context: '.',
    file: 'infra/docker/Dockerfile.webperf'
  },
  {
    name: 'probe',
    image: 'ghcr.io/webperf-and-guide/webperf-probe',
    context: './apps/probe-rs',
    file: 'apps/probe-rs/Dockerfile'
  },
  {
    name: 'browser-audit-lighthouse',
    image: 'ghcr.io/webperf-and-guide/webperf-browser-audit-lighthouse',
    context: '.',
    file: 'apps/browser-audit-lighthouse/Dockerfile'
  }
] as const;

type ReleaseImageName = (typeof releaseImages)[number]['name'];
type ReleasePlatform = 'linux/amd64' | 'linux/arm64';

type ReleaseImageSbom = {
  platform: ReleasePlatform;
  digest: string;
  file: string;
};

export type ReleaseImageMetadata = {
  schemaVersion: 2;
  name: ReleaseImageName;
  image: string;
  tag: string;
  digest: string;
  reference: string;
  platform: 'linux/amd64';
  sourceCommit: string;
  sbom: string;
  sboms?: ReleaseImageSbom[];
};

const repositoryRoot = resolve(import.meta.dir, '../..');
const prereleaseIdentifier = '(?:0|[1-9]\\d*|[A-Za-z-][0-9A-Za-z-]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)';
const versionPattern = new RegExp(
  `^0\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-${prereleaseIdentifier}(?:\\.${prereleaseIdentifier})*)?$`
);
const changesetBumpPattern = /^([^:\s][^:]*):\s*(patch|minor|major)$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const commitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const metadataKeys = [
  'digest',
  'image',
  'name',
  'platform',
  'reference',
  'sbom',
  'sboms',
  'schemaVersion',
  'sourceCommit',
  'tag'
];
const legacyMetadataKeys = metadataKeys.filter((key) => key !== 'sboms');
const releaseImageSbomKeys = ['digest', 'file', 'platform'];
const releasePlatforms: readonly ReleasePlatform[] = ['linux/amd64', 'linux/arm64'];

export function validateReleaseVersion(version: string) {
  if (!versionPattern.test(version)) {
    throw new Error(`Public beta release version must be v0-compatible SemVer without a v prefix: ${version}`);
  }
  return version;
}

export function repositoryReleaseVersion(root = repositoryRoot) {
  const versionFile = join(root, 'VERSION');
  const contents = readFileSync(versionFile, 'utf8');
  const version = contents.endsWith('\n') ? contents.slice(0, -1) : contents;
  if (version.includes('\n') || version.trim() !== version || contents !== `${version}\n`) {
    throw new Error('VERSION must contain one canonical release version followed by a newline');
  }
  return validateReleaseVersion(version);
}

export function validateRepositoryReleaseVersion(version: string, root = repositoryRoot) {
  validateReleaseVersion(version);
  const repositoryVersion = repositoryReleaseVersion(root);
  if (version !== repositoryVersion) {
    throw new Error(
      `Release ${version} must match the repository VERSION ${repositoryVersion}`
    );
  }
  return version;
}

export function isRepositoryReleaseSuccessor(currentVersion: string, nextVersion: string) {
  const current = parseReleaseVersion(currentVersion);
  const next = parseReleaseVersion(nextVersion);
  if (current.prerelease.length > 0 || next.prerelease.length > 0) {
    return false;
  }
  return (
    next.major === current.major
    && (
      (next.minor === current.minor && next.patch === current.patch + 1)
      || (next.minor === current.minor + 1 && next.patch === 0)
    )
  );
}

type ChangesetBump = 'patch' | 'minor' | 'major';

type PendingChangeset = {
  bump: ChangesetBump;
  description: string;
  file: string;
  source: string;
};

type PublicPackageVersion = {
  name: string;
  version: string;
};

export type ReleasePullRequestPreparation = {
  schemaVersion: 1;
  currentVersion: string;
  nextVersion: string;
  bump: 'patch' | 'minor';
  changesets: Array<{
    file: string;
    description: string;
  }>;
  packageVersions: PublicPackageVersion[];
};

export function prepareRepositoryRelease({
  root = repositoryRoot,
  date = new Date().toISOString().slice(0, 10)
}: {
  root?: string;
  date?: string;
} = {}) {
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || Number.isNaN(parsedDate.valueOf())
    || parsedDate.toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`Release date must use YYYY-MM-DD: ${date}`);
  }
  const changesets = readPendingChangesets(root);
  if (changesets.length === 0) {
    throw new Error('Repository release preparation requires at least one pending Sampo changeset');
  }

  const packageBump = highestChangesetBump(changesets.map(({ bump }) => bump));
  const repositoryBump = packageBump === 'patch' ? 'patch' : 'minor';
  const fingerprint = fingerprintChangesets(changesets);
  const currentVersion = repositoryReleaseVersion(root);
  const changelogFile = join(root, 'CHANGELOG.md');
  const composeEnvironmentFile = join(root, 'infra/docker-compose/.env.example');
  const composeEnvironment = readFileSync(composeEnvironmentFile, 'utf8');
  const composeVersion = composeEnvironmentVersion(composeEnvironment);
  const versionedEnvironments = [
    {
      label: 'Compose environment',
      file: composeEnvironmentFile,
      contents: composeEnvironment,
      version: composeVersion
    }
  ];
  const updateVersionedEnvironments = (
    targetVersion: string,
    allowedVersions: readonly string[],
    state: string
  ) => {
    for (const environment of versionedEnvironments) {
      if (!allowedVersions.includes(environment.version)) {
        throw new Error(
          `${environment.label} version ${environment.version} does not match ${state}`
        );
      }
      if (environment.version !== targetVersion) {
        writeTextFileAtomically(
          environment.file,
          renderComposeEnvironmentVersion(environment.contents, targetVersion)
        );
      }
    }
  };
  const changelog = readFileSync(changelogFile, 'utf8');
  const firstReleaseHeading = changelog.search(/^## \[/m);
  if (firstReleaseHeading === -1) {
    throw new Error('CHANGELOG.md has no repository release heading');
  }
  const releaseHistory = changelog.slice(firstReleaseHeading);
  const nextReleaseOffset = releaseHistory.slice(1).search(/^## \[/m);
  const latestReleaseEntry = nextReleaseOffset === -1
    ? releaseHistory
    : releaseHistory.slice(0, nextReleaseOffset + 1);
  const latestChangelogVersion = latestReleaseEntry.match(/^## \[([^\]]+)\]/)?.[1];
  const marker = latestReleaseEntry.match(
    /^<!-- webperf-release: from=(\S+); changesets=(sha256:[a-f0-9]{64}) -->$/m
  );
  if (marker?.[2] === fingerprint && latestChangelogVersion) {
    const preparedFromVersion = validateReleaseVersion(marker[1]);
    const preparedVersion = bumpRepositoryReleaseVersion(preparedFromVersion, packageBump);
    if (preparedVersion !== latestChangelogVersion) {
      throw new Error('The latest CHANGELOG.md release marker has an invalid version transition');
    }
    if (currentVersion === preparedFromVersion) {
      updateVersionedEnvironments(
        preparedVersion,
        [preparedFromVersion, preparedVersion],
        'the recoverable repository release'
      );
      writeTextFileAtomically(join(root, 'VERSION'), `${preparedVersion}\n`);
    } else if (currentVersion !== preparedVersion) {
      throw new Error(
        `The latest CHANGELOG.md release marker does not match VERSION ${currentVersion}`
      );
    } else {
      updateVersionedEnvironments(
        preparedVersion,
        [preparedFromVersion, preparedVersion],
        'the prepared repository release'
      );
    }
    return repositoryReleaseResult({
      currentVersion: preparedFromVersion,
      nextVersion: preparedVersion,
      bump: repositoryBump,
      changesets
    });
  }
  if (latestChangelogVersion !== currentVersion) {
    throw new Error(
      `The latest CHANGELOG.md entry ${latestChangelogVersion ?? '(unreadable)'} must match VERSION ${currentVersion}`
    );
  }
  for (const environment of versionedEnvironments) {
    if (environment.version !== currentVersion) {
      throw new Error(
        `${environment.label} version ${environment.version} must match VERSION ${currentVersion}`
      );
    }
  }
  const nextVersion = bumpRepositoryReleaseVersion(currentVersion, packageBump);
  const nextHeading = new RegExp(`^## \\[${escapeRegExp(nextVersion)}\\](?:\\s|$)`, 'm');
  if (nextHeading.test(changelog)) {
    throw new Error(`CHANGELOG.md already contains the next repository version ${nextVersion}`);
  }
  if (changelog.includes(`\n[${nextVersion}]:`)) {
    throw new Error(`CHANGELOG.md already contains a link for ${nextVersion}`);
  }

  const descriptions = changesets.map(({ description }) => `- ${description}`).join('\n');
  const entry = [
    `## [${nextVersion}] — ${date}`,
    '',
    '### Changes',
    '',
    descriptions,
    '',
    `<!-- webperf-release: from=${currentVersion}; changesets=${fingerprint} -->`
  ].join('\n');
  const introduction = changelog.slice(0, firstReleaseHeading).trimEnd();
  const priorReleases = changelog.slice(firstReleaseHeading).trim();
  const releaseLink = `[${nextVersion}]: https://github.com/Webperf-and-Guide/webperf-selfhosted/releases/tag/v${nextVersion}`;
  const nextChangelog = `${introduction}\n\n${entry}\n\n${priorReleases}\n${releaseLink}\n`;

  // Each replacement is atomic. Writing the changelog first is intentional:
  // its release marker lets a retry recognize and finish any partial VERSION
  // or environment-file update without incrementing the version twice.
  writeTextFileAtomically(changelogFile, nextChangelog);
  writeTextFileAtomically(
    composeEnvironmentFile,
    renderComposeEnvironmentVersion(composeEnvironment, nextVersion)
  );
  writeTextFileAtomically(join(root, 'VERSION'), `${nextVersion}\n`);

  return repositoryReleaseResult({
    currentVersion,
    nextVersion,
    bump: repositoryBump,
    changesets
  });
}

export function prepareReleasePullRequest({
  root = repositoryRoot,
  date = new Date().toISOString().slice(0, 10)
}: {
  root?: string;
  date?: string;
} = {}): ReleasePullRequestPreparation {
  const changesets = readPendingChangesets(root);
  const packageVersions = readPublicPackageVersions(root);
  const release = prepareRepositoryRelease({ root, date });
  return {
    schemaVersion: 1,
    currentVersion: release.currentVersion,
    nextVersion: release.nextVersion,
    bump: release.bump,
    changesets: changesets.map(({ file, description }) => ({ file, description })),
    packageVersions
  };
}

export function renderReleasePullRequest({
  preparation,
  root = repositoryRoot
}: {
  preparation: unknown;
  root?: string;
}) {
  const release = validateReleasePullRequestPreparation(preparation);
  const repositoryVersion = repositoryReleaseVersion(root);
  if (repositoryVersion !== release.nextVersion) {
    throw new Error(
      `Release pull request version ${release.nextVersion} does not match VERSION ${repositoryVersion}`
    );
  }

  const previousPackages = new Map(
    release.packageVersions.map(({ name, version }) => [name, version])
  );
  const currentPackages = new Map(
    readPublicPackageVersions(root).map(({ name, version }) => [name, version])
  );
  for (const name of previousPackages.keys()) {
    if (!currentPackages.has(name)) {
      throw new Error(`Public package disappeared during release preparation: ${name}`);
    }
  }
  for (const name of currentPackages.keys()) {
    if (!previousPackages.has(name)) {
      throw new Error(`Public package appeared during release preparation: ${name}`);
    }
  }

  const packageChanges = [...previousPackages]
    .flatMap(([name, previousVersion]) => {
      const nextVersion = currentPackages.get(name);
      if (nextVersion === undefined || nextVersion === previousVersion) {
        return [];
      }
      const comparison = compareSemanticVersions(previousVersion, nextVersion);
      if (comparison === 0) {
        throw new Error(
          `Public package ${name} did not increase in SemVer precedence from ${previousVersion} to ${nextVersion}`
        );
      }
      if (comparison > 0) {
        throw new Error(
          `Public package ${name} was downgraded from ${previousVersion} to ${nextVersion}`
        );
      }
      return [{ name, previousVersion, nextVersion }];
    });
  if (packageChanges.length === 0) {
    throw new Error('Sampo did not change any public package versions');
  }

  const changesetLabel = release.changesets.length === 1 ? 'changeset' : 'changesets';
  const packageRows = packageChanges.map(
    ({ name, previousVersion, nextVersion }) =>
      `| \`${name}\` | \`${previousVersion}\` | \`${nextVersion}\` |`
  );
  const body = [
    `## WebPerf v${release.nextVersion}`,
    '',
    `This automated release PR prepares one repository release from ${release.changesets.length} Sampo ${changesetLabel}.`,
    '',
    '### Change summary',
    '',
    ...release.changesets.map(({ description }) => `- ${description}`),
    '',
    '### Version changes',
    '',
    '| Scope | Before | After |',
    '| --- | --- | --- |',
    `| WebPerf repository | \`${release.currentVersion}\` | \`${release.nextVersion}\` |`,
    ...packageRows,
    '',
    'Package rows include dependency-propagated bumps generated by Sampo.',
    '',
    '### Review before merge',
    '',
    '- Required CI must pass.',
    '- Verify the root and package changelogs match the intended operator-visible changes.',
    '- Confirm version changes and any migration notes before merging.',
    '',
    `After merge, the protected release workflow will publish the GHCR images and install bundle for \`v${release.nextVersion}\` when that tag does not already exist. npm package publication remains a separate future concern.`,
    '',
    '<!-- webperf-release-pr: generated; schema=1 -->',
    ''
  ].join('\n');

  return {
    title: `chore(release): prepare WebPerf v${release.nextVersion}`,
    body,
    version: release.nextVersion,
    packageChanges
  };
}

export function writeReleaseImageMetadata({
  name,
  image,
  version,
  digest,
  amd64Digest,
  arm64Digest,
  sourceCommit,
  outputDirectory
}: {
  name: string;
  image: string;
  version: string;
  digest: string;
  amd64Digest: string;
  arm64Digest: string;
  sourceCommit: string;
  outputDirectory: string;
}) {
  const definition = releaseImages.find((candidate) => candidate.name === name);
  if (!definition || definition.image !== image) {
    throw new Error(`Unknown release image mapping: ${name} -> ${image}`);
  }
  validateReleaseVersion(version);
  if (!digestPattern.test(digest)) {
    throw new Error(`Invalid OCI digest for ${name}`);
  }
  if (!digestPattern.test(amd64Digest) || !digestPattern.test(arm64Digest)) {
    throw new Error(`Invalid platform OCI digest for ${name}`);
  }
  if (!commitPattern.test(sourceCommit)) {
    throw new Error(`Invalid source commit for ${name}`);
  }

  const amd64Sbom: ReleaseImageSbom = {
    platform: 'linux/amd64',
    digest: amd64Digest,
    file: releaseSbomFilename(definition.name, version, 'linux/amd64')
  };
  const arm64Sbom: ReleaseImageSbom = {
    platform: 'linux/arm64',
    digest: arm64Digest,
    file: releaseSbomFilename(definition.name, version, 'linux/arm64')
  };
  const sboms: ReleaseImageSbom[] = [amd64Sbom, arm64Sbom];

  const metadata: ReleaseImageMetadata = {
    schemaVersion: 2,
    name: definition.name,
    image: definition.image,
    tag: version,
    digest,
    reference: `${definition.image}@${digest}`,
    platform: 'linux/amd64',
    sourceCommit,
    sbom: amd64Sbom.file,
    sboms
  };

  mkdirSync(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, `${definition.name}.json`);
  writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
  return outputPath;
}

export function renderReleaseBundle({
  version,
  inputDirectory,
  outputDirectory
}: {
  version: string;
  inputDirectory: string;
  outputDirectory: string;
}) {
  validateReleaseVersion(version);
  if (existsSync(outputDirectory) && readdirSync(outputDirectory).length > 0) {
    throw new Error(`Release output directory must be empty: ${outputDirectory}`);
  }
  mkdirSync(outputDirectory, { recursive: true });

  const metadata = releaseImages.map((definition) =>
    readReleaseImageMetadata(join(inputDirectory, `${definition.name}.json`), definition, version)
  );
  const sourceCommits = new Set(metadata.map((entry) => entry.sourceCommit));
  if (sourceCommits.size !== 1) {
    throw new Error('Release images must all originate from the same source commit');
  }

  let compose = readFileSync(
    join(repositoryRoot, 'infra/docker-compose/compose.yml'),
    'utf8'
  );
  for (const entry of metadata) {
    const dynamicReference = new RegExp(
      `${escapeRegExp(entry.image)}:\\$\\{WEBPERF_VERSION:[^}]+\\}`,
      'g'
    );
    const matches = compose.match(dynamicReference);
    if (!matches?.length) {
      throw new Error(`Compose does not contain a version placeholder for ${entry.image}`);
    }
    compose = compose.replace(dynamicReference, () => entry.reference);
  }
  compose = compose.replace(/\$\{WEBPERF_VERSION:[^}]+\}/g, version);
  const probeMetadata = metadata.find((entry) => entry.name === 'probe');
  if (!probeMetadata) {
    throw new Error('Release metadata must include the probe image');
  }
  const probeDigestEnvironment = 'WEBPERF_PROBE_IMAGE_DIGEST: "${WEBPERF_PROBE_IMAGE_DIGEST:-}"';
  if (!compose.includes(probeDigestEnvironment)) {
    throw new Error('Compose does not contain the probe digest environment placeholder');
  }
  compose = compose.replace(
    probeDigestEnvironment,
    `WEBPERF_PROBE_IMAGE_DIGEST: "${probeMetadata.digest}"`
  );
  validateReleaseComposeImages(compose);
  writeFileSync(join(outputDirectory, 'compose.yml'), compose);

  copyFileSync(
    join(repositoryRoot, 'infra/docker-compose/browser-audit-seccomp.json'),
    join(outputDirectory, 'browser-audit-seccomp.json')
  );
  copyFileSync(
    join(repositoryRoot, 'infra/docker-compose/browser-audit.apparmor'),
    join(outputDirectory, 'browser-audit.apparmor')
  );
  copyFileSync(
    join(repositoryRoot, 'infra/docker-compose/compose.apparmor.yml'),
    join(outputDirectory, 'compose.apparmor.yml')
  );

  const readReleaseEnvExample = (path: string) => readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => (
      !line.startsWith('WEBPERF_VERSION=')
      && !line.startsWith('WEBPERF_PROBE_IMAGE_DIGEST=')
    ))
    .join('\n');
  const envExample = readReleaseEnvExample(
    join(repositoryRoot, 'infra/docker-compose/.env.example')
  );
  writeFileSync(join(outputDirectory, '.env.example'), envExample);

  const sbomDirectory = join(outputDirectory, 'sbom');
  mkdirSync(sbomDirectory);
  for (const entry of metadata) {
    const platformSboms = entry.sboms?.map(({ platform, file }) => ({ platform, file })) ?? [{
      platform: 'linux/amd64' as const,
      file: entry.sbom
    }];
    for (const sbom of platformSboms) {
      const source = join(inputDirectory, sbom.file);
      validateSpdxDocument(source, `${entry.name} (${sbom.platform})`);
      copyFileSync(source, join(sbomDirectory, sbom.file));
    }
  }

  const runtimeMetadata = {
    schemaVersion: 2,
    version,
    tag: `v${version}`,
    sourceCommit: metadata[0].sourceCommit,
    platform: 'linux/amd64',
    images: metadata.map(
      ({ sourceCommit: _sourceCommit, schemaVersion: _schemaVersion, ...entry }) => entry
    )
  };
  writeFileSync(
    join(outputDirectory, 'runtime-metadata.json'),
    `${JSON.stringify(runtimeMetadata, null, 2)}\n`
  );

  for (const file of ['LICENSE', 'VERSION', 'CHANGELOG.md', 'SECURITY.md']) {
    copyFileSync(join(repositoryRoot, file), join(outputDirectory, file));
  }
  writeFileSync(join(outputDirectory, 'README.md'), releaseReadme(version));
  writeChecksums(outputDirectory);

  return {
    outputDirectory,
    imageCount: metadata.length,
    sourceCommit: metadata[0].sourceCommit
  };
}

function readReleaseImageMetadata(
  path: string,
  definition: (typeof releaseImages)[number],
  version: string
) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `Unable to read release metadata ${basename(path)}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Release metadata is not an object: ${basename(path)}`);
  }
  const metadata = parsed as Partial<ReleaseImageMetadata>;
  const hasPlatformSboms = metadata.sboms !== undefined;
  const expectedSbomFile = hasPlatformSboms
    ? releaseSbomFilename(definition.name, version, 'linux/amd64')
    : legacySbomFilename(definition.name, version);
  const checks: Array<[valid: boolean, failure: string]> = [
    [
      Object.keys(metadata).sort().join('\n')
        === (hasPlatformSboms ? metadataKeys : legacyMetadataKeys).join('\n'),
      'metadata keys do not match the release schema'
    ],
    [metadata.schemaVersion === 2, 'schemaVersion must be 2'],
    [metadata.name === definition.name, `name must be ${definition.name}`],
    [metadata.image === definition.image, `image must be ${definition.image}`],
    [metadata.tag === version, `tag must be ${version}`],
    [
      typeof metadata.digest === 'string' && digestPattern.test(metadata.digest),
      'digest must be a lowercase sha256 OCI digest'
    ],
    [
      metadata.reference === `${definition.image}@${metadata.digest}`,
      'reference must match the approved image and digest'
    ],
    [metadata.platform === 'linux/amd64', 'platform must be linux/amd64'],
    [
      typeof metadata.sourceCommit === 'string' && commitPattern.test(metadata.sourceCommit),
      'sourceCommit must be a full SHA-1 or SHA-256 commit ID'
    ],
    [
      metadata.sbom === expectedSbomFile,
      `sbom must be ${expectedSbomFile}`
    ]
  ];
  if (hasPlatformSboms) {
    checks.push([
      hasExpectedPlatformSboms(metadata.sboms, definition.name, version),
      `sboms must cover linux/amd64 and linux/arm64 for ${definition.name}`
    ]);
  }
  const failures = checks.filter(([valid]) => !valid).map(([, failure]) => failure);
  if (failures.length > 0) {
    throw new Error(
      `Release metadata failed validation for ${basename(path)}: ${failures.join('; ')}`
    );
  }
  return metadata as ReleaseImageMetadata;
}

function hasExpectedPlatformSboms(
  value: unknown,
  name: string,
  version: string
): value is ReleaseImageSbom[] {
  if (!Array.isArray(value) || value.length !== releasePlatforms.length) {
    return false;
  }
  const candidates = value.filter((entry): entry is Partial<ReleaseImageSbom> => (
    entry !== null
    && typeof entry === 'object'
    && !Array.isArray(entry)
  ));
  return releasePlatforms.every((platform) => {
    const matching = candidates.filter((entry) => (
      Object.keys(entry).sort().join('\n') === releaseImageSbomKeys.join('\n')
      && entry.platform === platform
      && typeof entry.digest === 'string'
      && digestPattern.test(entry.digest)
      && entry.file === releaseSbomFilename(name, version, platform)
    ));
    return matching.length === 1;
  });
}

function releaseSbomFilename(
  name: string,
  version: string,
  platform: ReleasePlatform
): string {
  if (platform === 'linux/amd64') {
    return legacySbomFilename(name, version);
  }
  return `${name}-${version}-linux-arm64.spdx.json`;
}

function legacySbomFilename(name: string, version: string) {
  return `${name}-${version}.spdx.json`;
}

function validateSpdxDocument(path: string, imageName: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `Unable to read SPDX SBOM for ${imageName}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (
    !parsed
    || typeof parsed !== 'object'
    || !('spdxVersion' in parsed)
    || typeof parsed.spdxVersion !== 'string'
    || !parsed.spdxVersion.startsWith('SPDX-')
    || !('SPDXID' in parsed)
    || parsed.SPDXID !== 'SPDXRef-DOCUMENT'
  ) {
    throw new Error(`Invalid SPDX SBOM for ${imageName}`);
  }
}

export function validateReleaseComposeImages(compose: string) {
  if (compose.includes('${WEBPERF_VERSION')) {
    throw new Error('Release Compose contains an unresolved image version');
  }
  const imageLines = compose.split('\n').filter((line) => /^\s*image:/.test(line));
  const references = [...compose.matchAll(
    /^\s*image:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))(?:\s+#.*)?\s*$/gm
  )].map((match) => match[1] ?? match[2] ?? match[3]);
  if (references.length === 0 || references.length !== imageLines.length) {
    throw new Error('Release Compose contains an unreadable image reference');
  }
  for (const reference of references) {
    const valid = releaseImages.some(
      ({ image }) => new RegExp(`^${escapeRegExp(image)}@sha256:[a-f0-9]{64}$`).test(reference)
    );
    if (!valid) {
      throw new Error(`Release Compose image is not an approved digest reference: ${reference}`);
    }
  }
  return references;
}

type ParsedReleaseVersion = {
  raw: string;
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

function parseReleaseVersion(version: string): ParsedReleaseVersion {
  validateReleaseVersion(version);
  const prereleaseSeparator = version.indexOf('-');
  const core = prereleaseSeparator === -1 ? version : version.slice(0, prereleaseSeparator);
  const prerelease = prereleaseSeparator === -1 ? '' : version.slice(prereleaseSeparator + 1);
  const [major, minor, patch] = core.split('.').map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) {
    throw new Error(`Release version components must be safe integers: ${version}`);
  }
  return {
    raw: version,
    major,
    minor,
    patch,
    prerelease: prerelease ? prerelease.split('.') : []
  };
}

function compareSemanticVersions(left: string, right: string) {
  const parse = (version: string) => {
    const buildSeparator = version.indexOf('+');
    const withoutBuild = buildSeparator === -1 ? version : version.slice(0, buildSeparator);
    const build = buildSeparator === -1 ? [] : version.slice(buildSeparator + 1).split('.');
    const prereleaseSeparator = withoutBuild.indexOf('-');
    const core = prereleaseSeparator === -1
      ? withoutBuild
      : withoutBuild.slice(0, prereleaseSeparator);
    const prerelease = prereleaseSeparator === -1
      ? []
      : withoutBuild.slice(prereleaseSeparator + 1).split('.');
    const coreParts = core.split('.');
    if (
      coreParts.length !== 3
      || coreParts.some((part) => !/^(?:0|[1-9]\d*)$/.test(part))
      || prerelease.some(
        (part) =>
          !/^[0-9A-Za-z-]+$/.test(part)
          || (/^\d+$/.test(part) && !/^(?:0|[1-9]\d*)$/.test(part))
      )
      || build.some((part) => !/^[0-9A-Za-z-]+$/.test(part))
    ) {
      throw new Error(`Public package version is not valid SemVer: ${version}`);
    }
    const numericCore = coreParts.map(Number);
    if (!numericCore.every(Number.isSafeInteger)) {
      throw new Error(`Public package version components must be safe integers: ${version}`);
    }
    return {
      core: numericCore,
      prerelease
    };
  };

  const leftVersion = parse(left);
  const rightVersion = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftVersion.core[index] - rightVersion.core[index];
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  if (leftVersion.prerelease.length === 0 || rightVersion.prerelease.length === 0) {
    if (leftVersion.prerelease.length === rightVersion.prerelease.length) {
      return 0;
    }
    return leftVersion.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftVersion.prerelease[index];
    const rightIdentifier = rightVersion.prerelease[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      if (leftIdentifier === rightIdentifier) {
        return 0;
      }
      return leftIdentifier === undefined ? -1 : 1;
    }
    if (leftIdentifier === rightIdentifier) {
      continue;
    }
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      if (leftIdentifier.length === rightIdentifier.length) {
        return leftIdentifier < rightIdentifier ? -1 : 1;
      }
      return leftIdentifier.length < rightIdentifier.length ? -1 : 1;
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

export function isReleaseVersionNewerThan(candidate: string, baseline: string) {
  validateReleaseVersion(candidate);
  validateReleaseVersion(baseline);
  return compareSemanticVersions(candidate, baseline) > 0;
}

function readPendingChangesets(root: string): PendingChangeset[] {
  const changesetsDirectory = join(root, '.sampo/changesets');
  if (!existsSync(changesetsDirectory) || !lstatSync(changesetsDirectory).isDirectory()) {
    throw new Error(
      `Sampo changesets directory is missing or invalid: ${changesetsDirectory}`
    );
  }
  return readdirSync(changesetsDirectory)
    .filter((file) => file.endsWith('.md'))
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .map((file) => {
      const contents = readFileSync(join(changesetsDirectory, file), 'utf8')
        .replaceAll('\r\n', '\n');
      const match = contents.match(/^---\n([\s\S]*?)\n---\n+([\s\S]*?)\s*$/);
      if (!match) {
        throw new Error(`Invalid Sampo changeset structure: ${file}`);
      }
      const declarations = match[1].split('\n').filter((line) => line.trim().length > 0);
      if (declarations.length === 0) {
        throw new Error(`Sampo changeset has no package bumps: ${file}`);
      }
      const bumps = declarations.map((declaration) => {
        const declarationMatch = declaration.match(changesetBumpPattern);
        if (!declarationMatch) {
          throw new Error(`Invalid Sampo package bump in ${file}: ${declaration}`);
        }
        return declarationMatch[2] as ChangesetBump;
      });
      const body = match[2].trim().replace(/\s+/g, ' ');
      if (!body) {
        throw new Error(`Sampo changeset has no release description: ${file}`);
      }
      if (
        /^#{1,6}\s/.test(body)
        || body.includes('<!-- webperf-release:')
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)
      ) {
        throw new Error(`Sampo changeset has an unsafe release description: ${file}`);
      }
      return {
        bump: highestChangesetBump(bumps),
        description: body,
        file,
        source: contents
      };
    });
}

function readPublicPackageVersions(root: string): PublicPackageVersion[] {
  const packagesDirectory = join(root, 'packages');
  if (!existsSync(packagesDirectory) || !lstatSync(packagesDirectory).isDirectory()) {
    throw new Error(`Public packages directory is missing or invalid: ${packagesDirectory}`);
  }
  const packages = readdirSync(packagesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const manifestFile = join(packagesDirectory, entry.name, 'package.json');
      if (!existsSync(manifestFile) || !lstatSync(manifestFile).isFile()) {
        return [];
      }
      let manifest: unknown;
      try {
        manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
      } catch (error) {
        throw new Error(
          `Unable to read public package manifest ${entry.name}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new Error(`Package manifest is not an object: ${entry.name}`);
      }
      const candidate = manifest as {
        name?: unknown;
        private?: unknown;
        version?: unknown;
      };
      if (
        candidate.private !== false
        || typeof candidate.name !== 'string'
        || !candidate.name.startsWith('@webperf/')
      ) {
        return [];
      }
      if (
        !/^@webperf\/[a-z0-9][a-z0-9._-]*$/.test(candidate.name)
        || typeof candidate.version !== 'string'
        || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(candidate.version)
      ) {
        throw new Error(`Public package has invalid release metadata: ${entry.name}`);
      }
      return [{ name: candidate.name, version: candidate.version }];
    })
    .sort(({ name: left }, { name: right }) =>
      Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
    );
  const packageNames = new Set(packages.map(({ name }) => name));
  if (packageNames.size !== packages.length) {
    throw new Error('Public package names must be unique');
  }
  if (packages.length === 0) {
    throw new Error('No public @webperf packages were found');
  }
  return packages;
}

function validateReleasePullRequestPreparation(
  value: unknown
): ReleasePullRequestPreparation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Release pull request preparation is not an object');
  }
  const candidate = value as Partial<ReleasePullRequestPreparation>;
  const keys = Object.keys(candidate).sort().join('\n');
  const expectedKeys = [
    'bump',
    'changesets',
    'currentVersion',
    'nextVersion',
    'packageVersions',
    'schemaVersion'
  ].join('\n');
  if (keys !== expectedKeys || candidate.schemaVersion !== 1) {
    throw new Error('Release pull request preparation has an invalid schema');
  }
  if (
    typeof candidate.currentVersion !== 'string'
    || typeof candidate.nextVersion !== 'string'
    || (candidate.bump !== 'patch' && candidate.bump !== 'minor')
  ) {
    throw new Error('Release pull request preparation has invalid version metadata');
  }
  validateReleaseVersion(candidate.currentVersion);
  validateReleaseVersion(candidate.nextVersion);
  if (
    bumpRepositoryReleaseVersion(candidate.currentVersion, candidate.bump)
      !== candidate.nextVersion
  ) {
    throw new Error('Release pull request preparation has an invalid version transition');
  }
  if (!Array.isArray(candidate.changesets) || candidate.changesets.length === 0) {
    throw new Error('Release pull request preparation has no changesets');
  }
  const changesets = candidate.changesets.map((changeset) => {
    if (
      !changeset
      || typeof changeset !== 'object'
      || Array.isArray(changeset)
      || Object.keys(changeset).sort().join('\n') !== 'description\nfile'
      || typeof changeset.file !== 'string'
      || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/.test(changeset.file)
      || typeof changeset.description !== 'string'
      || changeset.description.trim() !== changeset.description
      || changeset.description.length === 0
      || /^#{1,6}\s/.test(changeset.description)
      || /<!-- webperf-release:/.test(changeset.description)
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(changeset.description)
    ) {
      throw new Error('Release pull request preparation has an invalid changeset');
    }
    return {
      file: changeset.file,
      description: changeset.description
    };
  });
  if (
    !Array.isArray(candidate.packageVersions)
    || candidate.packageVersions.length === 0
  ) {
    throw new Error('Release pull request preparation has no public packages');
  }
  const packageVersions = candidate.packageVersions.map((entry) => {
    if (
      !entry
      || typeof entry !== 'object'
      || Array.isArray(entry)
      || Object.keys(entry).sort().join('\n') !== 'name\nversion'
      || typeof entry.name !== 'string'
      || !/^@webperf\/[a-z0-9][a-z0-9._-]*$/.test(entry.name)
      || typeof entry.version !== 'string'
      || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(entry.version)
    ) {
      throw new Error('Release pull request preparation has an invalid package version');
    }
    return {
      name: entry.name,
      version: entry.version
    };
  });
  if (
    new Set(changesets.map(({ file }) => file)).size !== changesets.length
    || new Set(packageVersions.map(({ name }) => name)).size !== packageVersions.length
  ) {
    throw new Error('Release pull request preparation contains duplicate entries');
  }
  return {
    schemaVersion: 1,
    currentVersion: candidate.currentVersion,
    nextVersion: candidate.nextVersion,
    bump: candidate.bump,
    changesets,
    packageVersions
  };
}

function changesetBumpRank(bump: ChangesetBump) {
  return { patch: 0, minor: 1, major: 2 }[bump];
}

function highestChangesetBump(bumps: ChangesetBump[]) {
  return bumps.reduce<ChangesetBump>(
    (highest, bump) => (
      changesetBumpRank(bump) > changesetBumpRank(highest) ? bump : highest
    ),
    'patch'
  );
}

function bumpRepositoryReleaseVersion(version: string, bump: ChangesetBump) {
  const parsed = parseReleaseVersion(version);
  if (parsed.prerelease.length > 0) {
    throw new Error(`Automated repository releases require a stable VERSION: ${version}`);
  }
  if (bump === 'patch') {
    return parseReleaseVersion(
      `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`
    ).raw;
  }
  // Until v1, package minor and major changes both advance the repository
  // minor so breaking public-beta releases remain inside the v0 channel.
  return parseReleaseVersion(`${parsed.major}.${parsed.minor + 1}.0`).raw;
}

function fingerprintChangesets(changesets: PendingChangeset[]) {
  const hash = createHash('sha256');
  for (const { file, source } of changesets) {
    hash.update(file);
    hash.update('\0');
    hash.update(source);
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

function repositoryReleaseResult({
  currentVersion,
  nextVersion,
  bump,
  changesets
}: {
  currentVersion: string;
  nextVersion: string;
  bump: 'patch' | 'minor';
  changesets: PendingChangeset[];
}) {
  return {
    currentVersion,
    nextVersion,
    bump,
    changesets: changesets.map(({ file }) => file)
  };
}

export function composeEnvironmentVersion(environment: string) {
  const versions = environment
    .split(/\r?\n/)
    .filter((line) => line.startsWith('WEBPERF_VERSION='))
    .map((line) => line.slice('WEBPERF_VERSION='.length));
  if (versions.length !== 1) {
    throw new Error('Compose environment must contain exactly one WEBPERF_VERSION');
  }
  return validateReleaseVersion(versions[0]);
}

function renderComposeEnvironmentVersion(environment: string, version: string) {
  validateReleaseVersion(version);
  composeEnvironmentVersion(environment);
  return environment.replace(
    /^WEBPERF_VERSION=.*$/m,
    `WEBPERF_VERSION=${version}`
  );
}

function writeTextFileAtomically(file: string, contents: string) {
  const temporaryFile = join(
    dirname(file),
    `.webperf-release-${basename(file)}-${randomUUID()}.tmp`
  );
  try {
    const descriptor = openSync(temporaryFile, 'wx', 0o644);
    try {
      writeFileSync(descriptor, contents);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporaryFile, file);
  } finally {
    rmSync(temporaryFile, { force: true });
  }
}

function writeChecksums(outputDirectory: string) {
  const files = walkFiles(outputDirectory)
    .filter((path) => basename(path) !== 'SHA256SUMS')
    .sort((left, right) => Buffer.compare(
      Buffer.from(relative(outputDirectory, left), 'utf8'),
      Buffer.from(relative(outputDirectory, right), 'utf8')
    ));
  const lines = files.map((path) => {
    const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
    return `${digest}  ${relative(outputDirectory, path)}`;
  });
  writeFileSync(join(outputDirectory, 'SHA256SUMS'), `${lines.join('\n')}\n`);
}

function walkFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) {
      throw new Error(`Release bundle cannot contain symbolic links: ${path}`);
    }
    return stats.isDirectory() ? walkFiles(path) : [path];
  });
}

function releaseReadme(version: string) {
  return `# WebPerf ${version}\n\nThis release bundle pins every runtime image by OCI digest.\n\n## Start\n\n\`\`\`sh\ncp .env.example .env\n# Replace every placeholder secret before continuing.\ndocker compose --env-file .env -f compose.yml up -d\n\`\`\`\n\nOpen \`http://127.0.0.1:5173\`. Only the console is published by default. Keep \`browser-audit-seccomp.json\`, \`browser-audit.apparmor\`, and \`compose.apparmor.yml\` beside \`compose.yml\` when enabling Browser Audit. On an AppArmor 4 host, install \`browser-audit.apparmor\` as \`/etc/apparmor.d/webperf-browser-audit\`, load it with \`sudo apparmor_parser -r -W /etc/apparmor.d/webperf-browser-audit\`, then add \`-f compose.apparmor.yml\` to the Browser Audit Compose command.\n\nVerify bundle files with \`sha256sum --check SHA256SUMS\`. Runtime image digests are recorded in \`runtime-metadata.json\`, and SPDX JSON SBOMs live under \`sbom/\`.\n\nRead \`SECURITY.md\` before exposing the console through a reverse proxy.\n`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (import.meta.main) {
  const [command, ...args] = Bun.argv.slice(2);
  try {
    if (command === 'metadata' && args.length === 8) {
      const [
        name,
        image,
        version,
        digest,
        amd64Digest,
        arm64Digest,
        sourceCommit,
        outputDirectory
      ] = args;
      console.log(
        JSON.stringify({
          ok: true,
          path: writeReleaseImageMetadata({
            name,
            image,
            version,
            digest,
            amd64Digest,
            arm64Digest,
            sourceCommit,
            outputDirectory
          })
        })
      );
    } else if (command === 'bundle' && args.length === 3) {
      const [version, inputDirectory, outputDirectory] = args;
      console.log(
        JSON.stringify({
          ok: true,
          ...renderReleaseBundle({ version, inputDirectory, outputDirectory })
        })
      );
    } else if (command === 'validate-version' && args.length === 1) {
      console.log(JSON.stringify({ ok: true, version: validateReleaseVersion(args[0]) }));
    } else if (command === 'is-newer-than' && args.length === 2) {
      console.log(JSON.stringify({
        ok: true,
        newer: isReleaseVersionNewerThan(args[0], args[1])
      }));
    } else if (command === 'validate-repository-version' && args.length === 1) {
      console.log(
        JSON.stringify({ ok: true, version: validateRepositoryReleaseVersion(args[0]) })
      );
    } else if (command === 'repository-version' && args.length === 0) {
      console.log(JSON.stringify({ ok: true, version: repositoryReleaseVersion() }));
    } else if (command === 'prepare-repository-release' && args.length === 0) {
      console.log(JSON.stringify({ ok: true, ...prepareRepositoryRelease() }));
    } else if (command === 'prepare-release-pull-request' && args.length === 1) {
      const outputFile = args[0]!;
      const preparation = prepareReleasePullRequest();
      writeTextFileAtomically(
        outputFile,
        `${JSON.stringify(preparation, null, 2)}\n`
      );
      console.log(JSON.stringify({
        ok: true,
        path: outputFile,
        version: preparation.nextVersion
      }));
    } else if (command === 'render-release-pull-request' && args.length === 2) {
      const preparationFile = args[0]!;
      const outputFile = args[1]!;
      const preparation = JSON.parse(readFileSync(preparationFile, 'utf8')) as unknown;
      const pullRequest = renderReleasePullRequest({ preparation });
      writeTextFileAtomically(outputFile, pullRequest.body);
      console.log(JSON.stringify({
        ok: true,
        path: outputFile,
        title: pullRequest.title,
        version: pullRequest.version,
        packageCount: pullRequest.packageChanges.length
      }));
    } else {
      throw new Error(
        'Usage: release-bundle.ts metadata <name> <image> <version> <digest> <amd64-digest> <arm64-digest> <commit> <output-dir> | bundle <version> <input-dir> <output-dir> | validate-version <version> | is-newer-than <candidate> <baseline> | validate-repository-version <version> | repository-version | prepare-repository-release | prepare-release-pull-request <output-json> | render-release-pull-request <input-json> <output-markdown>'
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
