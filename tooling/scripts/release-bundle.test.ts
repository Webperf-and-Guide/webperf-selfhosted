import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  composeEnvironmentVersion,
  isReleaseVersionNewerThan,
  isRepositoryReleaseSuccessor,
  releaseImages,
  renderReleaseBundle,
  renderReleasePullRequest,
  prepareRepositoryRelease,
  prepareReleasePullRequest,
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
    expect(isReleaseVersionNewerThan('0.3.0', '0.2.1')).toBeTrue();
    expect(isReleaseVersionNewerThan('0.3.0-beta.1', '0.2.1')).toBeTrue();
    expect(isReleaseVersionNewerThan('0.2.1', '0.2.1')).toBeFalse();
    expect(isReleaseVersionNewerThan('0.2.0', '0.2.1')).toBeFalse();
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

  test('renders a versioned release pull request with changes and package bumps', () => {
    const root = writeRepositoryReleaseFixture({
      version: '0.2.1',
      changesets: {
        'public-contract.md': `---
npm/@webperf/contracts: minor
---

Add a stateless probe capabilities contract.
`,
        'runtime-mode.md': `---
npm/@webperf/config: minor
---

Expose probe concurrency through self-host configuration.
`
      },
      packages: {
        config: { name: '@webperf/config', version: '0.2.1' },
        contracts: { name: '@webperf/contracts', version: '0.2.0' },
        'report-core': { name: '@webperf/report-core', version: '0.1.1' }
      }
    });

    const preparation = prepareReleasePullRequest({ root, date: '2026-07-28' });
    expect(preparation).toMatchObject({
      schemaVersion: 1,
      currentVersion: '0.2.1',
      nextVersion: '0.3.0',
      bump: 'minor',
      changesets: [
        {
          file: 'public-contract.md',
          description: 'Add a stateless probe capabilities contract.'
        },
        {
          file: 'runtime-mode.md',
          description: 'Expose probe concurrency through self-host configuration.'
        }
      ]
    });

    writePublicPackageManifest(root, 'config', '@webperf/config', '0.3.0');
    writePublicPackageManifest(root, 'contracts', '@webperf/contracts', '0.3.0');
    writePublicPackageManifest(root, 'report-core', '@webperf/report-core', '0.1.2');

    const pullRequest = renderReleasePullRequest({ root, preparation });
    expect(pullRequest.title).toBe('chore(release): prepare WebPerf v0.3.0');
    expect(pullRequest.packageChanges).toEqual([
      {
        name: '@webperf/config',
        previousVersion: '0.2.1',
        nextVersion: '0.3.0'
      },
      {
        name: '@webperf/contracts',
        previousVersion: '0.2.0',
        nextVersion: '0.3.0'
      },
      {
        name: '@webperf/report-core',
        previousVersion: '0.1.1',
        nextVersion: '0.1.2'
      }
    ]);
    expect(pullRequest.body).toContain('## WebPerf v0.3.0');
    expect(pullRequest.body).toContain(
      'prepares one repository release from 2 Sampo changesets'
    );
    expect(pullRequest.body).toContain(
      '- Add a stateless probe capabilities contract.'
    );
    expect(pullRequest.body).toContain(
      '| `@webperf/report-core` | `0.1.1` | `0.1.2` |'
    );
    expect(pullRequest.body).toContain(
      'Package rows include dependency-propagated bumps generated by Sampo.'
    );
    expect(pullRequest.body).toContain(
      'the protected release workflow will prepare `v0.3.0`'
    );

    const prereleasePreparation = {
      ...preparation,
      packageVersions: preparation.packageVersions.map((entry) =>
        entry.name === '@webperf/contracts'
          ? { ...entry, version: '0.3.0-beta.2' }
          : entry
      )
    };
    writePublicPackageManifest(root, 'contracts', '@webperf/contracts', '0.3.0-beta.10');
    expect(
      renderReleasePullRequest({ root, preparation: prereleasePreparation }).packageChanges
    ).toContainEqual({
      name: '@webperf/contracts',
      previousVersion: '0.3.0-beta.2',
      nextVersion: '0.3.0-beta.10'
    });

    expect(() => renderReleasePullRequest({
      root,
      preparation: {
        ...preparation,
        changesets: preparation.changesets.map((changeset, index) =>
          index === 0
            ? { ...changeset, description: '# Injected release heading' }
            : changeset
        )
      }
    })).toThrow('Release pull request preparation has an invalid changeset');

    writePublicPackageManifest(root, 'contracts', '@webperf/contracts', '0.2.0+build.1');
    expect(() => renderReleasePullRequest({ root, preparation }))
      .toThrow(
        'Public package @webperf/contracts did not increase in SemVer precedence from 0.2.0 to 0.2.0+build.1'
      );

    writePublicPackageManifest(root, 'contracts', '@webperf/contracts', '0.1.9');
    expect(() => renderReleasePullRequest({ root, preparation }))
      .toThrow('Public package @webperf/contracts was downgraded from 0.2.0 to 0.1.9');
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

  test('renders a complete digest-pinned bundle from three image records', () => {
    const root = makeTemporaryDirectory();
    const version = repositoryReleaseVersion();
    const output = join(root, `webperf-selfhosted-v${version}`);
    const sourceCommit = 'a'.repeat(40);
    const input = writeValidReleaseInputs(root, version, sourceCommit);

    const result = renderReleaseBundle({
      version,
      inputDirectory: input,
      outputDirectory: output
    });
    const compose = readFileSync(join(output, 'compose.yml'), 'utf8');
    const runtimeMetadata = JSON.parse(
      readFileSync(join(output, 'runtime-metadata.json'), 'utf8')
    );

    expect(result.imageCount).toBe(3);
    expect(result.sourceCommit).toBe(sourceCommit);
    expect(compose).not.toContain('WEBPERF_VERSION');
    expect(compose).toContain(`WEBPERF_RUNTIME_VERSION: "${version}"`);
    const probeMetadata = runtimeMetadata.images.find(
      (entry: { name: string }) => entry.name === 'probe'
    );
    expect(probeMetadata).toBeDefined();
    expect(compose).toContain(
      `WEBPERF_PROBE_IMAGE_DIGEST: "${probeMetadata.digest}"`
    );
    expect(compose).not.toContain('${WEBPERF_PROBE_IMAGE_DIGEST');
    // webperf + optional scheduler + probe + browser-audit + 2 debug
    // services produce six digest-pinned image references.
    expect(validateReleaseComposeImages(compose)).toHaveLength(6);
    for (const definition of releaseImages) {
      expect(compose).toContain(`${definition.image}@sha256:`);
      for (const suffix of ['', '-linux-arm64']) {
        expect(readFileSync(
          join(output, 'sbom', `${definition.name}-${version}${suffix}.spdx.json`),
          'utf8'
        )).toContain('SPDXRef-DOCUMENT');
      }
    }
    expect(runtimeMetadata.images).toHaveLength(3);
    expect(runtimeMetadata.images[0].sboms).toEqual([
      {
        platform: 'linux/amd64',
        digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        file: `webperf-${version}.spdx.json`
      },
      {
        platform: 'linux/arm64',
        digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        file: `webperf-${version}-linux-arm64.spdx.json`
      }
    ]);
    const releaseEnvironment = readFileSync(join(output, '.env.example'), 'utf8');
    expect(releaseEnvironment).not.toContain('WEBPERF_VERSION=');
    expect(releaseEnvironment).not.toContain('WEBPERF_PROBE_IMAGE_DIGEST=');
    expect(readFileSync(join(output, 'SHA256SUMS'), 'utf8')).toContain(
      'runtime-metadata.json'
    );
    expect(readFileSync(join(output, 'VERSION'), 'utf8')).toBe(`${version}\n`);
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
    const metadataPath = join(input, 'webperf.json');
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as Record<string, unknown>;
    metadata.tag = '0.2.1';
    metadata.sbom = 'wrong.spdx.json';
    writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

    expect(() => renderReleaseBundle({
      version: '0.2.0',
      inputDirectory: input,
      outputDirectory: join(root, 'output')
    })).toThrow(
      'tag must be 0.2.0; sbom must be webperf-0.2.0.spdx.json'
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
        amd64Digest: `sha256:${'b'.repeat(64)}`,
        arm64Digest: `sha256:${'c'.repeat(64)}`,
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
    const digest = createFixtureDigest(`index:${definition.name}`);
    const amd64Digest = createFixtureDigest(`linux/amd64:${definition.name}`);
    const arm64Digest = createFixtureDigest(`linux/arm64:${definition.name}`);
    writeReleaseImageMetadata({
      ...definition,
      version,
      digest,
      amd64Digest,
      arm64Digest,
      sourceCommit,
      outputDirectory: input
    });
    for (const suffix of ['', '-linux-arm64']) {
      writeFileSync(
        join(input, `${definition.name}-${version}${suffix}.spdx.json`),
        JSON.stringify({
          spdxVersion: 'SPDX-2.3',
          SPDXID: 'SPDXRef-DOCUMENT',
          name: `${definition.name}${suffix}`
        })
      );
    }
  }
  return input;
}

function createFixtureDigest(value: string) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function writeRepositoryReleaseFixture({
  version,
  changesets,
  packages = {}
}: {
  version: string;
  changesets: Record<string, string>;
  packages?: Record<string, { name: string; version: string }>;
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
  for (const [directory, { name, version: packageVersion }] of Object.entries(packages)) {
    writePublicPackageManifest(root, directory, name, packageVersion);
  }
  return root;
}

function writePublicPackageManifest(
  root: string,
  directory: string,
  name: string,
  version: string
) {
  const packageDirectory = join(root, 'packages', directory);
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(
    join(packageDirectory, 'package.json'),
    `${JSON.stringify({ name, version, private: false }, null, 2)}\n`
  );
}
