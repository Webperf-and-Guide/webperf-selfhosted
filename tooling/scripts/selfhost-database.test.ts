import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../..');
const databaseScript = join(repositoryRoot, 'tooling/scripts/selfhost-database.ts');
const testSecret = 'selfhost-database-command-test-secret';
const tempDirectories: string[] = [];

const createDatabasePath = () => {
  const directory = mkdtempSync(join(tmpdir(), 'webperf-selfhost-command-'));
  tempDirectories.push(directory);
  return join(directory, 'webperf.sqlite');
};

const runDatabaseCommand = async (
  args: string[],
  environment: Record<string, string> = {}
) => {
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );
  const subprocess = Bun.spawn(
    [process.execPath, databaseScript, ...args],
    {
      cwd: repositoryRoot,
      env: { ...inheritedEnvironment, ...environment },
      stdout: 'pipe',
      stderr: 'pipe'
    }
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text()
  ]);

  return {
    exitCode,
    stdout: stdout.trim(),
    stderr: stderr.trim()
  };
};

const initializeDatabase = async (databasePath: string) => {
  const result = await runDatabaseCommand(
    ['migrate', '--database', databasePath],
    { SELFHOST_INTERNAL_SECRET: testSecret }
  );

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
};

afterEach(() => {
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();

    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe('self-host database commands', () => {
  test('does not require storage secrets when migrations are already current', async () => {
    const databasePath = createDatabasePath();
    await initializeDatabase(databasePath);

    const result = await runDatabaseCommand(
      ['migrate', '--database', databasePath],
      {
        SELFHOST_INTERNAL_SECRET: '',
        SELFHOST_INTERNAL_SECRET_NEXT: ''
      }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: 'migrate',
      databasePath,
      appliedNow: [],
      pending: []
    });
  });

  test('reports artifact reconciliation failure as partial maintenance', async () => {
    const databasePath = createDatabasePath();
    await initializeDatabase(databasePath);

    const result = await runDatabaseCommand([
      'maintenance',
      '--database',
      databasePath,
      '--artifacts',
      '/'
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      partial: true,
      command: 'maintenance',
      databasePath,
      artifactsPath: '/',
      retentionDays: 30,
      vacuumed: false,
      artifactCleanup: {
        ok: false,
        errorType: 'Error',
        error: 'Browser Audit artifact root must not be a filesystem root'
      }
    });
  });
});
