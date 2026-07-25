import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  composeEnvironmentVersion,
  isRepositoryReleaseSuccessor,
  releaseImages,
  renderReleaseBundle,
  prepareRepositoryRelease,
  repositoryReleaseVersion,
  validateReleaseComposeImages,
  validateRepositoryReleaseVersion,
  validateReleaseVersion,
  writeReleaseImageMetadata
} from './release-bundle';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('release bundle generation', () => {
  test('reports a repository version accepted by the release validator', () => {
    const version = repositoryReleaseVersion();
    expect(validateRepositoryReleaseVersion(version)).toBe(version);
    expect(isRepositoryReleaseSuccessor('0.2.0', '0.2.1')).toBeTrue();
    expect(isRepositoryReleaseSuccessor('0.2.7', '0.3.0')).toBeTrue();
    expect(isRepositoryReleaseSuccessor('0.2.7', '0.4.0')).toBeFalse();
    expect(isRepositoryReleaseSuccessor('0.2.7', '0.2.9')).toBeFalse();
    expect(composeEnvironmentVersion('WEBPERF_VERSION=0.2.0\n')).toBe('0.2.0');
    expect(() => composeEnvironmentVersion(
      'WEBPERF_VERSION=0.2.0\nWEBPERF_VERSION=0.2.1\n'
    )).toThrow('exactly one WEBPERF_VERSION');
  });

  test('advances an independent repository patch and root changelog', () => {
    const root = writeRepositoryReleaseFixture({
      version: '0.2.0',
      changesets: {
        'report-fix.md': `---
npm/@webperf/report-core: patch
---

Keep report comparison output deterministic across equivalent inputs.
`
      }
    });

    const expectedResult = {
      currentVersion: '0.2.0',
      nextVersion: '0.2.1',
      bump: 'patch',
      changesets: ['report-fix.md']
    } as const;
    expect(prepareRepositoryRelease({ root, date: '2026-07-26' })).toEqual(
      expectedResult
    );
    expect(readFileSync(join(root, 'VERSION'), 'utf8')).toBe('0.2.1\n');
    expect(readFileSync(
      join(root, 'infra/docker-compose/.env.example'),
      'utf8'
    )).toContain('WEBPERF_VERSION=0.2.1');
    const preparedChangelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
    expect(preparedChangelog).toContain(
      '## [0.2.1] — 2026-07-26\n\n### Changes\n\n'
      + '- Keep report comparison output deterministic across equivalent inputs.'
    );
    expect(preparedChangelog).toContain(
      '<!-- webperf-release: from=0.2.0; changesets=sha256:'
    );
    expect(validateRepositoryReleaseVersion('0.2.1', root)).toBe('0.2.1');
    expect(() => validateRepositoryReleaseVersion('0.2.0', root)).toThrow(
      'must match the repository VERSION 0.2.1'
    );

    // A retry repairs the only cross-file partial state and does not bump
    // again after both files have already reached the prepared version.
    writeFileSync(join(root, 'VERSION'), '0.2.0\n');
    writeFileSync(
      join(root, 'infra/docker-compose/.env.example'),
      'WEBPERF_VERSION=0.2.0\nUNCHANGED=value\n'
    );
    expect(prepareRepositoryRelease({ root, date: '2026-07-27' })).toEqual(
      expectedResult
    );
    expect(readFileSync(join(root, 'VERSION'), 'utf8')).toBe('0.2.1\n');
    expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(preparedChangelog);
    expect(composeEnvironmentVersion(readFileSync(
      join(root, 'infra/docker-compose/.env.example'),
      'utf8'
    ))).toBe('0.2.1');
    expect(prepareRepositoryRelease({ root, date: '2026-07-27' })).toEqual(
      expectedResult
    );
    expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(preparedChangelog);
  });

  test('maps public-beta minor and major changesets to one repository minor', () => {
    for (const bump of ['minor', 'major'] as const) {
      const root = writeRepositoryReleaseFixture({
        version: '0.2.7',
        changesets: {
          [`public-${bump}.md`]: `---
npm/@webperf/contracts: ${bump}
---

Publish a new public contract surface.
`
        }
      });

      expect(prepareRepositoryRelease({ root, date: '2026-07-26' })).toMatchObject({
        currentVersion: '0.2.7',
        nextVersion: '0.3.0',
        bump: 'minor'
      });
    }
  });

  test('rejects malformed or empty repository release preparation', () => {
    const missingRoot = makeTemporaryDirectory();
    expect(() => prepareRepositoryRelease({ root: missingRoot, date: '2026-07-26' }))
      .toThrow('Sampo changesets directory is missing or invalid');

    const emptyRoot = writeRepositoryReleaseFixture({
      version: '0.2.0',
      changesets: {}
    });
    expect(() => prepareRepositoryRelease({ root: emptyRoot, date: '2026-07-26' }))
      .toThrow('requires at least one pending Sampo changeset');

    const malformedRoot = writeRepositoryReleaseFixture({
      version: '0.2.0',
      changesets: {
        'malformed.md': 'not a changeset\n'
      }
    });
    expect(() => prepareRepositoryRelease({ root: malformedRoot, date: '2026-07-26' }))
      .toThrow('Invalid Sampo changeset structure: malformed.md');

    const unsafeRoot = writeRepositoryReleaseFixture({
      version: '0.2.0',
      changesets: {
        'unsafe.md': `---
npm/@webperf/contracts: patch
---

# Replace the changelog structure.
`
      }
    });
    expect(() => prepareRepositoryRelease({ root: unsafeRoot, date: '2026-07-26' }))
      .toThrow('Sampo changeset has an unsafe release description: unsafe.md');
  });

  test('renders a complete digest-pinned bundle from six image records', () => {
    const root = makeTemporaryDirectory();
    const output = join(root, 'webperf-selfhosted-v0.2.0');
    const sourceCommit = 'a'.repeat(40);
    const input = writeValidReleaseInputs(root, '0.2.0', sourceCommit);

    const result = renderReleaseBundle({
      version: '0.2.0',
      inputDirectory: input,
      outputDirectory: output
    });
    const compose = readFileSync(join(output, 'compose.yml'), 'utf8');
    const runtimeMetadata = JSON.parse(
      readFileSync(join(output, 'runtime-metadata.json'), 'utf8')
    );

    expect(result.imageCount).toBe(6);
    expect(result.sourceCommit).toBe(sourceCommit);
    expect(compose).not.toContain('WEBPERF_VERSION');
    expect(compose).toContain('WEBPERF_RUNTIME_VERSION: "0.2.0"');
    expect(validateReleaseComposeImages(compose)).toHaveLength(8);
    for (const definition of releaseImages) {
      expect(compose).toContain(`${definition.image}@sha256:`);
    }
    expect(runtimeMetadata.images).toHaveLength(6);
    expect(readFileSync(join(output, '.env.example'), 'utf8')).not.toContain(
      'WEBPERF_VERSION='
    );
    expect(readFileSync(join(output, 'SHA256SUMS'), 'utf8')).toContain(
      'runtime-metadata.json'
    );
    expect(readFileSync(join(output, 'VERSION'), 'utf8')).toBe('0.2.0\n');
    expect(JSON.parse(
      readFileSync(join(output, 'browser-audit-seccomp.json'), 'utf8')
    ).defaultAction).toBe('SCMP_ACT_ERRNO');
    expect(readFileSync(join(output, 'browser-audit.apparmor'), 'utf8')).toContain(
      'profile "webperf-browser-audit"'
    );
    expect(readFileSync(join(output, 'compose.apparmor.yml'), 'utf8')).toContain(
      'apparmor=webperf-browser-audit'
    );
    const checksumPaths = readFileSync(join(output, 'SHA256SUMS'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => line.split('  ')[1] ?? '');
    expect(checksumPaths).toContain('browser-audit-seccomp.json');
    expect(checksumPaths).toContain('browser-audit.apparmor');
    expect(checksumPaths).toContain('compose.apparmor.yml');
    expect(checksumPaths).toEqual([...checksumPaths].sort((left, right) =>
      Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
    ));
  });

  test('identifies every invalid release metadata field', () => {
    const root = makeTemporaryDirectory();
    const input = writeValidReleaseInputs(root, '0.2.0', 'a'.repeat(40));
    const metadataPath = join(input, 'console.json');
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as Record<string, unknown>;
    metadata.tag = '0.2.1';
    metadata.sbom = 'wrong.spdx.json';
    writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

    expect(() => renderReleaseBundle({
      version: '0.2.0',
      inputDirectory: input,
      outputDirectory: join(root, 'output')
    })).toThrow(
      'tag must be 0.2.0; sbom must be console-0.2.0.spdx.json'
    );
  });

  test('rejects malformed versions and mismatched image identities', () => {
    expect(() => validateReleaseVersion('v0.2.0')).toThrow();
    expect(() => validateReleaseVersion('1.0.0')).toThrow();
    expect(() => validateReleaseVersion('0.02.0')).toThrow();
    expect(() => validateReleaseVersion('0.2.0-01')).toThrow();
    expect(validateReleaseVersion('0.2.0-beta.1')).toBe('0.2.0-beta.1');
    expect(() =>
      writeReleaseImageMetadata({
        name: 'probe',
        image: 'ghcr.io/example/not-probe',
        version: '0.2.0',
        digest: `sha256:${'a'.repeat(64)}`,
        sourceCommit: 'b'.repeat(40),
        outputDirectory: makeTemporaryDirectory()
      })
    ).toThrow();
  });

  test('rejects every tagged or unapproved release Compose image', () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    expect(
      validateReleaseComposeImages(`services:\n  api:\n    image: "${releaseImages[1].image}@${digest}"`)
    ).toEqual([`${releaseImages[1].image}@${digest}`]);
    for (const reference of [
      `${releaseImages[1].image}:main`,
      `${releaseImages[1].image}:beta`,
      `${releaseImages[1].image}:0.2.0`,
      `docker.io/example/api@${digest}`
    ]) {
      expect(() =>
        validateReleaseComposeImages(`services:\n  api:\n    image: "${reference}"`)
      ).toThrow();
    }
  });
});

function makeTemporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'webperf-release-'));
  temporaryDirectories.push(directory);
  return directory;
}

function writeValidReleaseInputs(root: string, version: string, sourceCommit: string) {
  const input = join(root, 'input');
  for (const definition of releaseImages) {
    const digest = `sha256:${createHash('sha256').update(definition.name).digest('hex')}`;
    writeReleaseImageMetadata({
      ...definition,
      version,
      digest,
      sourceCommit,
      outputDirectory: input
    });
    writeFileSync(
      join(input, `${definition.name}-${version}.spdx.json`),
      JSON.stringify({
        spdxVersion: 'SPDX-2.3',
        SPDXID: 'SPDXRef-DOCUMENT',
        name: definition.name
      })
    );
  }
  return input;
}

function writeRepositoryReleaseFixture({
  version,
  changesets
}: {
  version: string;
  changesets: Record<string, string>;
}) {
  const root = makeTemporaryDirectory();
  const changesetsDirectory = join(root, '.sampo/changesets');
  const composeDirectory = join(root, 'infra/docker-compose');
  mkdirSync(changesetsDirectory, { recursive: true });
  mkdirSync(composeDirectory, { recursive: true });
  writeFileSync(join(root, 'VERSION'), `${version}\n`);
  writeFileSync(
    join(composeDirectory, '.env.example'),
    `WEBPERF_VERSION=${version}\nUNCHANGED=value\n`
  );
  writeFileSync(
    join(root, 'CHANGELOG.md'),
    `# Changelog\n\nRepository release history.\n\n## [${version}] — 2026-07-25\n\nInitial release.\n\n[${version}]: https://github.com/Webperf-and-Guide/webperf-selfhosted/releases/tag/v${version}\n`
  );
  for (const [file, contents] of Object.entries(changesets)) {
    writeFileSync(join(changesetsDirectory, file), contents);
  }
  return root;
}
