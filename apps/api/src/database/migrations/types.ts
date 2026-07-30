import type { Database } from 'bun:sqlite';
import type { StorageCrypto } from '../../storage-crypto';

export type SqliteMigrationContext = {
  storageCrypto: StorageCrypto;
  runtimeRegionId?: string;
};

export type SqliteMigration = {
  id: string;
  up(database: Database, context: SqliteMigrationContext): void;
};
