import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';

const temporaryDirectories: string[] = [];
const script = resolve(import.meta.dir, 'release-tag.sh');

function run(cwd: string, command: string, args: string[]) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1'
    }
  });
}

function requireSuccess(result: ReturnType<typeof run>) {
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}

function createRepository() {
  const root = mkdtempSync(join(tmpdir(), 'webperf-release-tag-'));
  temporaryDirectories.push(root);
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');

  requireSuccess(run(root, 'git', ['init', '--bare', origin]));
  requireSuccess(run(root, 'git', ['init', '--initial-branch=main', work]));
  requireSuccess(run(work, 'git', ['config', 'user.name', 'Release Test']));
  requireSuccess(run(work, 'git', ['config', 'user.email', 'release-test@example.invalid']));
  writeFileSync(join(work, 'release.txt'), 'first\n');
  requireSuccess(run(work, 'git', ['add', 'release.txt']));
  requireSuccess(run(work, 'git', ['commit', '-m', 'initial release source']));
  requireSuccess(run(work, 'git', ['remote', 'add', 'origin', origin]));
  requireSuccess(run(work, 'git', ['push', '-u', 'origin', 'main']));

  const sourceSha = run(work, 'git', ['rev-parse', 'HEAD']).stdout.trim();
  return { origin, sourceSha, work };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('immutable release tag helper', () => {
  test('verifies an absent tag and publishes it idempotently', () => {
    const { origin, sourceSha, work } = createRepository();

    requireSuccess(run(work, 'bash', [script, 'verify', 'v0.2.0', sourceSha, '0.2.0']));
    requireSuccess(
      run(work, 'bash', [script, 'verify', 'v0.2.0-rc.1', sourceSha, '0.2.0-rc.1'])
    );
    expect(run(work, 'git', ['ls-remote', '--tags', origin, 'refs/tags/v0.2.0']).stdout).toBe('');

    requireSuccess(run(work, 'bash', [script, 'publish', 'v0.2.0', sourceSha, '0.2.0']));
    requireSuccess(run(work, 'bash', [script, 'publish', 'v0.2.0', sourceSha, '0.2.0']));
    const publishedSource = run(
      work,
      'git',
      ['ls-remote', origin, 'refs/tags/v0.2.0^{}']
    ).stdout.split(/\s+/)[0];
    expect(publishedSource).toBe(sourceSha);
  });

  test('rejects a mismatched existing tag and invalid arguments', () => {
    const { sourceSha, work } = createRepository();
    requireSuccess(run(work, 'bash', [script, 'publish', 'v0.2.0', sourceSha, '0.2.0']));

    writeFileSync(join(work, 'release.txt'), 'second\n');
    requireSuccess(run(work, 'git', ['commit', '-am', 'next source']));
    const nextSha = run(work, 'git', ['rev-parse', 'HEAD']).stdout.trim();

    expect(run(work, 'bash', [script, 'verify', 'v0.2.0', nextSha, '0.2.0']).status).not.toBe(0);
    expect(run(work, 'bash', [script, 'publish', 'v0.2.0', sourceSha, '0.2.1']).status).not.toBe(0);
    expect(run(work, 'bash', [script, 'unknown', 'v0.2.0', sourceSha, '0.2.0']).status).not.toBe(0);
  });

  test('rejects an existing lightweight tag', () => {
    const { sourceSha, work } = createRepository();
    requireSuccess(run(work, 'git', ['tag', 'v0.2.0', sourceSha]));
    requireSuccess(run(work, 'git', ['push', 'origin', 'refs/tags/v0.2.0']));

    expect(run(work, 'bash', [script, 'verify', 'v0.2.0', sourceSha, '0.2.0']).status).not.toBe(0);
  });

  test('replaces a stale local tag when the remote tag is absent', () => {
    const { origin, sourceSha, work } = createRepository();
    requireSuccess(run(work, 'git', ['tag', 'v0.2.0', sourceSha]));

    requireSuccess(run(work, 'bash', [script, 'publish', 'v0.2.0', sourceSha, '0.2.0']));
    expect(run(work, 'git', ['cat-file', '-t', 'v0.2.0']).stdout.trim()).toBe('tag');
    const publishedSource = run(
      work,
      'git',
      ['ls-remote', origin, 'refs/tags/v0.2.0^{}']
    ).stdout.split(/\s+/)[0];
    expect(publishedSource).toBe(sourceSha);
  });
});
