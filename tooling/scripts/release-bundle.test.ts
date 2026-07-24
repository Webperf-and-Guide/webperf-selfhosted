import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  releaseImages,
  renderReleaseBundle,
  validateReleaseComposeImages,
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
