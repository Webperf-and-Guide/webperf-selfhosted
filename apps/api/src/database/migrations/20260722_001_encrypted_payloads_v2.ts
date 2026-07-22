import type { SqliteMigration } from './types';

type PersistedPayloadRow = {
  rowid: number;
  payload_json: string;
};

export const encryptedPayloadMigration: SqliteMigration = {
  id: '20260722_001_encrypted_payloads_v2',
  up(database, context) {
    for (const table of ['jobs', 'saved_entities', 'check_profile_runs'] as const) {
      const rows = database
        .query<PersistedPayloadRow, []>(`SELECT rowid, payload_json FROM ${table}`)
        .all();
      const update = database.query(`UPDATE ${table} SET payload_json = ? WHERE rowid = ?`);

      for (const row of rows) {
        const parsed = context.storageCrypto.parse(row.payload_json, { allowPlaintext: true });
        update.run(context.storageCrypto.stringify(parsed), row.rowid);
      }
    }
  }
};
