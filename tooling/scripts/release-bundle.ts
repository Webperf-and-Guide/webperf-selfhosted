import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

export const releaseImages = [
  { name: 'console', image: 'ghcr.io/webperf-and-guide/webperf-console' },
  { name: 'api', image: 'ghcr.io/webperf-and-guide/webperf-api' },
  { name: 'scheduler', image: 'ghcr.io/webperf-and-guide/webperf-scheduler' },
  { name: 'executor', image: 'ghcr.io/webperf-and-guide/webperf-executor' },
  { name: 'probe', image: 'ghcr.io/webperf-and-guide/webperf-probe' },
  {
    name: 'browser-audit-lighthouse',
    image: 'ghcr.io/webperf-and-guide/webperf-browser-audit-lighthouse'
  }
] as const;

type ReleaseImageName = (typeof releaseImages)[number]['name'];

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
};

const repositoryRoot = resolve(import.meta.dir, '../..');
const prereleaseIdentifier = '(?:0|[1-9]\\d*|[A-Za-z-][0-9A-Za-z-]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)';
const versionPattern = new RegExp(
  `^0\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-${prereleaseIdentifier}(?:\\.${prereleaseIdentifier})*)?$`
);
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const commitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const metadataKeys = [
  'digest',
  'image',
  'name',
  'platform',
  'reference',
  'sbom',
  'schemaVersion',
  'sourceCommit',
  'tag'
];

export function validateReleaseVersion(version: string) {
  if (!versionPattern.test(version)) {
    throw new Error(`Public beta release version must be v0-compatible SemVer without a v prefix: ${version}`);
  }
  return version;
}

export function validateRepositoryReleaseVersion(version: string) {
  validateReleaseVersion(version);
  const packageManifests = readdirSync(join(repositoryRoot, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(repositoryRoot, 'packages', entry.name, 'package.json'))
    .filter(existsSync)
    .map((path) => JSON.parse(readFileSync(path, 'utf8')) as { name?: unknown; version?: unknown });
  const publicPackages = packageManifests.filter(
    (manifest): manifest is { name: string; version?: unknown } =>
      typeof manifest.name === 'string' && manifest.name.startsWith('@webperf/')
  );
  for (const manifest of publicPackages) {
    if (typeof manifest.version !== 'string') {
      throw new Error(`Public package ${manifest.name} has no release version`);
    }
  }
  const packageVersions = publicPackages as Array<{ name: string; version: string }>;
  if (packageVersions.length === 0) {
    throw new Error('No public @webperf package versions were found');
  }
  const releaseVersion = parseReleaseVersion(version);
  const highestVersion = packageVersions
    .map(({ version: packageVersion, name }) => ({ name, version: parseReleaseVersion(packageVersion) }))
    .sort((left, right) => compareReleaseVersions(right.version, left.version))[0];
  if (compareReleaseVersions(releaseVersion, highestVersion.version) !== 0) {
    throw new Error(
      `Release ${version} must match the highest Sampo-managed public package version ${highestVersion.version.raw} (${highestVersion.name})`
    );
  }
  return version;
}

export function writeReleaseImageMetadata({
  name,
  image,
  version,
  digest,
  sourceCommit,
  outputDirectory
}: {
  name: string;
  image: string;
  version: string;
  digest: string;
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
  if (!commitPattern.test(sourceCommit)) {
    throw new Error(`Invalid source commit for ${name}`);
  }

  const metadata: ReleaseImageMetadata = {
    schemaVersion: 1,
    name: definition.name,
    image: definition.image,
    tag: version,
    digest,
    reference: `${definition.image}@${digest}`,
    platform: 'linux/amd64',
    sourceCommit,
    sbom: `${definition.name}-${version}.spdx.json`
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
    const source = join(inputDirectory, entry.sbom);
    validateSpdxDocument(source, entry.name);
    copyFileSync(source, join(sbomDirectory, entry.sbom));
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

  for (const file of ['LICENSE', 'CHANGELOG.md', 'SECURITY.md']) {
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
  const checks: Array<[valid: boolean, failure: string]> = [
    [
      Object.keys(metadata).sort().join('\n') === metadataKeys.join('\n'),
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
      metadata.sbom === `${definition.name}-${version}.spdx.json`,
      `sbom must be ${definition.name}-${version}.spdx.json`
    ]
  ];
  const failures = checks.filter(([valid]) => !valid).map(([, failure]) => failure);
  if (failures.length > 0) {
    throw new Error(
      `Release metadata failed validation for ${basename(path)}: ${failures.join('; ')}`
    );
  }
  return metadata as ReleaseImageMetadata;
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
  return {
    raw: version,
    major,
    minor,
    patch,
    prerelease: prerelease ? prerelease.split('.') : []
  };
}

function compareReleaseVersions(left: ParsedReleaseVersion, right: ParsedReleaseVersion) {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) {
      return left[key] - right[key];
    }
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) {
      return 0;
    }
    if (left.prerelease.length === 0) {
      return 1;
    }
    return -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === undefined ? -1 : 1;
    }
    if (leftIdentifier === rightIdentifier) {
      continue;
    }
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return Number(leftIdentifier) - Number(rightIdentifier);
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

function writeChecksums(outputDirectory: string) {
  const files = walkFiles(outputDirectory)
    .filter((path) => basename(path) !== 'SHA256SUMS')
    .sort((left, right) => left.localeCompare(right));
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
  return `# WebPerf ${version}\n\nThis release bundle pins every runtime image by OCI digest.\n\n## Start\n\n\`\`\`sh\ncp .env.example .env\n# Replace every placeholder secret before continuing.\ndocker compose --env-file .env -f compose.yml up -d\n\`\`\`\n\nOpen \`http://127.0.0.1:5173\`. Only the console is published by default.\n\nVerify bundle files with \`sha256sum --check SHA256SUMS\`. Runtime image digests are recorded in \`runtime-metadata.json\`, and SPDX JSON SBOMs live under \`sbom/\`.\n\nRead \`SECURITY.md\` before exposing the console through a reverse proxy.\n`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (import.meta.main) {
  const [command, ...args] = Bun.argv.slice(2);
  try {
    if (command === 'metadata' && args.length === 6) {
      const [name, image, version, digest, sourceCommit, outputDirectory] = args;
      console.log(
        JSON.stringify({
          ok: true,
          path: writeReleaseImageMetadata({
            name,
            image,
            version,
            digest,
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
    } else {
      throw new Error(
        'Usage: release-bundle.ts metadata <name> <image> <version> <digest> <commit> <output-dir> | bundle <version> <input-dir> <output-dir> | validate-version <version> | validate-repository-version <version>'
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
