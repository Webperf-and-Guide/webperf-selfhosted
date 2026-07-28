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
  schemaVersion: 1;
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
      if (composeVersion !== preparedFromVersion && composeVersion !== preparedVersion) {
        throw new Error(
          `Compose environment version ${composeVersion} does not match the recoverable repository release`
        );
      }
      if (composeVersion !== preparedVersion) {
        writeTextFileAtomically(
          composeEnvironmentFile,
          renderComposeEnvironmentVersion(composeEnvironment, preparedVersion)
        );
      }
      writeTextFileAtomically(join(root, 'VERSION'), `${preparedVersion}\n`);
    } else if (currentVersion !== preparedVersion) {
      throw new Error(
        `The latest CHANGELOG.md release marker does not match VERSION ${currentVersion}`
      );
    } else if (composeVersion !== preparedVersion) {
      if (composeVersion !== preparedFromVersion) {
        throw new Error(
          `Compose environment version ${composeVersion} does not match the prepared repository release`
        );
      }
      writeTextFileAtomically(
        composeEnvironmentFile,
        renderComposeEnvironmentVersion(composeEnvironment, preparedVersion)
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
  if (composeVersion !== currentVersion) {
    throw new Error(
      `Compose environment version ${composeVersion} must match VERSION ${currentVersion}`
    );
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
  // its release marker lets a retry recognize and finish any cross-file
  // partial state without incrementing the version twice.
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
    schemaVersion: 1,
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

  const envExample = readFileSync(
    join(repositoryRoot, 'infra/docker-compose/.env.example'),
    'utf8'
  )
    .split('\n')
    .filter((line) => !line.startsWith('WEBPERF_VERSION='))
    .join('\n');
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
    schemaVersion: 1,
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
    [metadata.schemaVersion === 1, 'schemaVersion must be 1'],
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
    } else if (command === 'validate-repository-version' && args.length === 1) {
      console.log(
        JSON.stringify({ ok: true, version: validateRepositoryReleaseVersion(args[0]) })
      );
    } else if (command === 'repository-version' && args.length === 0) {
      console.log(JSON.stringify({ ok: true, version: repositoryReleaseVersion() }));
    } else if (command === 'prepare-repository-release' && args.length === 0) {
      console.log(JSON.stringify({ ok: true, ...prepareRepositoryRelease() }));
    } else {
      throw new Error(
        'Usage: release-bundle.ts metadata <name> <image> <version> <digest> <amd64-digest> <arm64-digest> <commit> <output-dir> | bundle <version> <input-dir> <output-dir> | validate-version <version> | validate-repository-version <version> | repository-version | prepare-repository-release'
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
