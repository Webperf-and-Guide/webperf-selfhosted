import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applySqliteMigrations,
  getSqliteMigrationState,
  openSqliteDatabase
} from '../../apps/api/src/database/sqlite';
import {
  backupSqliteDatabase,
  createSqliteBackupFromConnection,
  defaultSqliteBackupPath,
  defaultSqliteStorageCryptoVerificationLimit,
  doctorSqliteDatabase,
  maintainSqliteDatabase,
  restoreSqliteDatabase
} from '../../apps/api/src/database/operations';
import { createStorageCrypto } from '../../apps/api/src/storage-crypto';
import { LocalBrowserAuditArtifactStore } from '../../apps/api/src/browser-audit-artifact-store';

type Command = 'migrate' | 'backup' | 'restore' | 'doctor' | 'maintenance';

class MigrationWithBackupError extends Error {
  override readonly name = 'MigrationWithBackupError';

  constructor(
    message: string,
    readonly backupPath: string,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}

const command = process.argv[2] as Command | undefined;
const args = process.argv.slice(3);

const optionValue = (name: string) => {
  const index = args.indexOf(name);

  if (index < 0) {
    return undefined;
  }

  const value = args[index + 1];

  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }

  return value;
};

const hasFlag = (name: string) => args.includes(name);
const valueOptions = new Set([
  '--database',
  '--backup-output',
  '--output',
  '--from',
  '--max-verify-payloads',
  '--retention-days',
  '--artifacts'
]);
const flagOptions = new Set([
  '--backup',
  '--no-backup',
  '--vacuum',
  '--allow-pending-migrations'
]);
const positionalArgs: string[] = [];

for (let index = 0; index < args.length; index += 1) {
  const value = args[index]!;

  if (valueOptions.has(value)) {
    index += 1;
  } else if (!value.startsWith('--')) {
    positionalArgs.push(value);
  }
}

const resolveDatabasePath = () => {
  const configured = optionValue('--database')
    ?? process.env.SELFHOST_DATABASE_PATH
    ?? './data/webperf.sqlite';
  return configured === ':memory:' ? configured : resolve(configured);
};

const resolveArtifactsPath = () => resolve(
  optionValue('--artifacts')
    ?? process.env.SELFHOST_ARTIFACTS_PATH
    ?? './data/artifacts'
);

const parsePositiveInteger = (value: string | undefined, fallback: number, label: string) => {
  if (value == null) {
    return fallback;
  }

  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${label} must be a positive decimal integer`);
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive decimal integer`);
  }

  return parsed;
};

const requireStorageCrypto = () => {
  const currentSecret = process.env.SELFHOST_INTERNAL_SECRET?.trim();
  const nextSecret = process.env.SELFHOST_INTERNAL_SECRET_NEXT?.trim() || undefined;

  if (!currentSecret || currentSecret.length < 16) {
    throw new Error('SELFHOST_INTERNAL_SECRET must contain at least 16 characters for migrations and restore');
  }

  if (nextSecret && nextSecret.length < 16) {
    throw new Error('SELFHOST_INTERNAL_SECRET_NEXT must contain at least 16 characters when set');
  }

  return createStorageCrypto({ currentSecret, nextSecret });
};

const migrate = () => {
  const databasePath = resolveDatabasePath();
  const existed = databasePath !== ':memory:'
    && existsSync(databasePath)
    && statSync(databasePath).size > 0;
  const database = openSqliteDatabase(databasePath);
  let backupPath: string | null = null;

  try {
    const result = applySqliteMigrations(
      database,
      () => ({ storageCrypto: requireStorageCrypto() }),
      {
        beforeMigrate() {
          const backupRequested = hasFlag('--backup')
            || optionValue('--backup-output') != null
            || process.env.SELFHOST_MIGRATION_BACKUP === 'true';

          if (backupRequested && existed) {
            backupPath = resolve(
              optionValue('--backup-output') ?? defaultSqliteBackupPath(databasePath)
            );
            createSqliteBackupFromConnection(database, backupPath);
          }
        }
      }
    );

    return {
      ok: true,
      command: 'migrate',
      databasePath,
      backupPath,
      appliedNow: result.appliedNow,
      pending: result.pending
    };
  } catch (error) {
    if (backupPath) {
      throw new MigrationWithBackupError(
        `SQLite migration failed; recovery backup is available at ${backupPath}`,
        backupPath,
        { cause: error }
      );
    }
    throw error;
  } finally {
    database.close();
  }
};

const backup = () => {
  const databasePath = resolveDatabasePath();
  const configuredOutput = optionValue('--output');
  const destinationPath = configuredOutput
    ? resolve(configuredOutput)
    : defaultSqliteBackupPath(databasePath);

  backupSqliteDatabase({ databasePath, destinationPath });
  return { ok: true, command: 'backup', databasePath, backupPath: destinationPath };
};

const restore = () => {
  const storageCrypto = requireStorageCrypto();
  const databasePath = resolveDatabasePath();
  const configuredSource = optionValue('--from') ?? positionalArgs[0];

  if (!configuredSource) {
    throw new Error('Restore requires a backup path: selfhost:restore -- <path>');
  }

  const sourcePath = resolve(configuredSource);
  const result = restoreSqliteDatabase({
    databasePath,
    sourcePath,
    storageCrypto,
    backupCurrent: !hasFlag('--no-backup'),
    allowPendingMigrations: hasFlag('--allow-pending-migrations'),
    maximumPayloadsToVerify: parsePositiveInteger(
      optionValue('--max-verify-payloads'),
      defaultSqliteStorageCryptoVerificationLimit,
      'Restore payload verification limit'
    )
  });

  return { ok: true, command: 'restore', ...result };
};

const doctor = () => ({
  command: 'doctor',
  ...doctorSqliteDatabase(resolveDatabasePath())
});

const describeOperationError = (error: unknown) => ({
  error: error instanceof Error ? error.message : 'Unknown database operation failure',
  errorType: error instanceof Error
    ? error.name
    : Object.prototype.toString.call(error).slice(8, -1) || 'Unknown'
});

const reconcileArtifacts = async (databasePath: string, artifactsPath: string) => {
  const currentDatabase = openSqliteDatabase(databasePath, { readonly: true, create: false });
  let storageKeys: string[];

  try {
    storageKeys = currentDatabase
      .query<{ storage_key: string }, []>(
        'SELECT storage_key FROM browser_audit_artifacts ORDER BY storage_key'
      )
      .all()
      .map((row) => row.storage_key);
  } finally {
    currentDatabase.close();
  }

  return new LocalBrowserAuditArtifactStore(artifactsPath)
    .reconcile(new Set(storageKeys));
};

const maintenance = async () => {
  const databasePath = resolveDatabasePath();
  const database = openSqliteDatabase(databasePath, { readonly: true, create: false });

  try {
    const migrations = getSqliteMigrationState(database);

    if (migrations.pending.length > 0 || migrations.unknown.length > 0) {
      throw new Error('Database schema is not current; run selfhost:migrate before maintenance');
    }
  } finally {
    database.close();
  }

  const retentionDays = parsePositiveInteger(
    optionValue('--retention-days') ?? process.env.SELFHOST_RETENTION_DAYS,
    30,
    'Retention days'
  );
  const result = maintainSqliteDatabase({
    databasePath,
    retentionDays,
    vacuum: hasFlag('--vacuum')
  });
  const artifactsPath = resolveArtifactsPath();
  let artifactCleanup;
  try {
    artifactCleanup = {
      ok: true as const,
      ...(await reconcileArtifacts(databasePath, artifactsPath))
    };
  } catch (error) {
    artifactCleanup = {
      ok: false as const,
      ...describeOperationError(error)
    };
  }

  return {
    ok: artifactCleanup.ok,
    partial: !artifactCleanup.ok,
    command: 'maintenance',
    databasePath,
    artifactsPath,
    retentionDays,
    artifactCleanup,
    ...result
  };
};

const printHelp = () => {
  console.error(`Usage: bun run selfhost:<command> [options]

Commands:
  selfhost:migrate [--backup] [--backup-output <path>] [--database <path>]
  selfhost:backup [--output <path>] [--database <path>]
  selfhost:restore -- <path> [--no-backup] [--allow-pending-migrations] [--max-verify-payloads <count>] [--database <path>]
  selfhost:doctor [--database <path>]
  selfhost:maintenance [--retention-days <days>] [--vacuum] [--database <path>] [--artifacts <path>]`);
};

const main = async () => {
  const unknownOption = args.find(
    (value) => value.startsWith('--')
      && value !== '--'
      && !valueOptions.has(value)
      && !flagOptions.has(value)
  );

  if (unknownOption) {
    throw new Error(`Unknown option: ${unknownOption}`);
  }

  switch (command) {
    case 'migrate':
      return migrate();
    case 'backup':
      return backup();
    case 'restore':
      return restore();
    case 'doctor':
      return doctor();
    case 'maintenance':
      return maintenance();
    default:
      printHelp();
      throw new Error(`Unknown self-host database command: ${command ?? 'missing'}`);
  }
};

try {
  const result = await main();
  console.log(JSON.stringify(result));

  if ('ok' in result && result.ok === false) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    command: command ?? null,
    ...describeOperationError(error),
    ...(error instanceof MigrationWithBackupError ? { backupPath: error.backupPath } : {})
  }));
  process.exitCode = 1;
}
