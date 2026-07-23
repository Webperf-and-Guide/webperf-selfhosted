import type { SqliteMigration } from './types';

type PersistedPayloadRow = {
  rowid: number;
  payload_json: string;
};

export const encryptedPayloadMigration: SqliteMigration = {
  id: '20260722_001_encrypted_payloads_v2',
  up(database, context) {
    for (const table of ['jobs', 'saved_entities', 'check_profile_runs'] as const) {
      const readFirstBatch = database.query<PersistedPayloadRow, []>(`
        SELECT rowid, payload_json
        FROM ${table}
        ORDER BY rowid
        LIMIT 100
      `);
      const readNextBatch = database.query<PersistedPayloadRow, [number]>(`
        SELECT rowid, payload_json
        FROM ${table}
        WHERE rowid > ?
        ORDER BY rowid
        LIMIT 100
      `);
      const update = database.query(`UPDATE ${table} SET payload_json = ? WHERE rowid = ?`);
      let lastRowId: number | null = null;

      try {
        while (true) {
          const rows: PersistedPayloadRow[] = lastRowId === null
            ? readFirstBatch.all()
            : readNextBatch.all(lastRowId);
          if (rows.length === 0) {
            break;
          }

          for (const row of rows) {
            const parsed = context.storageCrypto.parse(row.payload_json, { allowPlaintext: true });
            update.run(context.storageCrypto.stringify(parsed), row.rowid);
            lastRowId = row.rowid;
          }
        }
      } finally {
        readFirstBatch.finalize();
        readNextBatch.finalize();
        update.finalize();
      }
    }
  }
};
