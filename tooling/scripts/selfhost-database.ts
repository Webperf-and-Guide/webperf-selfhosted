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
  doctorSqliteDatabase,
  maintainSqliteDatabase,
  restoreSqliteDatabase
} from '../../apps/api/src/database/operations';
import { createStorageCrypto } from '../../apps/api/src/storage-crypto';

type Command = 'migrate' | 'backup' | 'restore' | 'doctor' | 'maintenance';

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
  '--retention-days'
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
    throw new Error('SELFHOST_INTERNAL_SECRET must contain at least 16 characters for migrations');
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
      { storageCrypto: requireStorageCrypto() },
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
  const databasePath = resolveDatabasePath();
  const configuredSource = optionValue('--from') ?? positionalArgs[0];

  if (!configuredSource) {
    throw new Error('Restore requires a backup path: selfhost:restore -- <path>');
  }

  const sourcePath = resolve(configuredSource);
  const result = restoreSqliteDatabase({
    databasePath,
    sourcePath,
    backupCurrent: !hasFlag('--no-backup'),
    allowPendingMigrations: hasFlag('--allow-pending-migrations')
  });

  return { ok: true, command: 'restore', ...result };
};

const doctor = () => ({
  command: 'doctor',
  ...doctorSqliteDatabase(resolveDatabasePath())
});

const maintenance = () => {
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

  return { ok: true, command: 'maintenance', databasePath, retentionDays, ...result };
};

const printHelp = () => {
  console.error(`Usage: bun run selfhost:<command> [options]

Commands:
  selfhost:migrate [--backup] [--backup-output <path>] [--database <path>]
  selfhost:backup [--output <path>] [--database <path>]
  selfhost:restore -- <path> [--no-backup] [--allow-pending-migrations] [--database <path>]
  selfhost:doctor [--database <path>]
  selfhost:maintenance [--retention-days <days>] [--vacuum] [--database <path>]`);
};

const main = () => {
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
  const result = main();
  console.log(JSON.stringify(result));

  if ('ok' in result && result.ok === false) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    command: command ?? null,
    error: error instanceof Error ? error.message : 'Unknown database operation failure'
  }));
  process.exitCode = 1;
}
