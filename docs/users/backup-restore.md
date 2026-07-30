# Back up and restore WebPerf

A complete recovery record contains three things:

1. a verified SQLite snapshot;
2. the matching artifact directory;
3. the `.env` values—especially the current and next internal encryption
   secrets—needed to decrypt the snapshot.

Store these outside the live Docker volume with restricted permissions. Test
restores on a separate host or Compose project.

The repository continuously exercises this boundary with
`bun run drill:compose:recovery`. The drill creates real Fast Check and Browser
Audit records, copies SQLite plus artifact bytes outside an isolated Compose
volume, deletes that test volume, restores both halves, runs `migrate` and
`doctor`, and verifies the original records and artifact digest. Formal release
smoke also runs the same drill against the downloaded digest-pinned bundle.
The release gate separately starts the public `v0.2.1` bundle, creates its
legacy multi-region records, replaces the runtime with the candidate published
bundle on the same named volume, and verifies the stored-data migration. That
cross-version drill proves the earliest supported public beta can reach the
current single-region model without silently reassigning historical locations
or scheduled Checks.
This is destructive only to its uniquely named `webperf-recovery-*` test
project; operators must follow the stopped-writer procedure below and must
never reuse the drill as a production backup command.

## Create a consistent Compose backup

Create a private destination, stop new work, and ask SQLite for a compact,
WAL-aware snapshot:

```sh
mkdir -m 700 -p backups/current

# Stop all writers to freeze new work. In the default embedded mode the
# scheduler runs inside the supervised webperf container.
# If you run an external scheduler (--profile external-scheduler), stop
# that container explicitly as well.
docker compose --env-file .env -f compose.yml stop webperf

# Run the backup as a one-shot container. Override the entrypoint so the
# role dispatcher does not start the API; the db subcommand bypasses it.
docker compose --env-file .env -f compose.yml run --rm --no-deps \
  --user 1000:1000 \
  --entrypoint bun webperf \
  /app/tooling/scripts/selfhost-database.ts backup \
  --database /data/webperf.sqlite \
  --output /data/webperf-backup.sqlite

docker compose --env-file .env -f compose.yml cp \
  webperf:/data/webperf-backup.sqlite backups/current/webperf.sqlite
docker compose --env-file .env -f compose.yml cp \
  webperf:/data/artifacts/. backups/current/artifacts/
cp .env backups/current/webperf.env
chmod 600 backups/current/webperf.env backups/current/webperf.sqlite

# Restart the stack. Add --profile external-scheduler if you use that mode
# so the standalone scheduler container also restarts; without it, the
# scheduler stays stopped and scheduled Checks will not dispatch.
docker compose --env-file .env -f compose.yml up -d
# For external-scheduler mode: docker compose --env-file .env -f compose.yml --profile external-scheduler up -d
```

The backup command refuses to overwrite an existing file, writes mode `0600`,
and runs SQLite integrity and foreign-key checks. Use a unique backup
destination each time. After verifying the external copy, remove the temporary
`/data/webperf-backup.sqlite` in a planned maintenance operation so it does not
accumulate inside the volume.

If Browser Audit is disabled and `/data/artifacts` is empty, keep an empty
artifact directory in the backup so the recovery boundary remains explicit.

## Verify the backup

Record checksums outside the backup directory and protect them from the same
failure domain:

```sh
sha256sum backups/current/webperf.sqlite > backups/current.sqlite.sha256
```

Run `doctor` against a copied snapshot on a test installation. A file existing
on disk is not proof that it is current, decryptable, or internally consistent.

## Restore SQLite

Stop every writer. Copy the selected backup into the existing `webperf` container,
then run the guarded restore in a one-off container attached to the same named
volume:

```sh
docker compose --env-file .env --profile browser-audit -f compose.yml stop
docker compose --env-file .env -f compose.yml cp \
  backups/current/webperf.sqlite webperf:/data/restore.sqlite

docker compose --env-file .env -f compose.yml run --rm --no-deps \
  --user 1000:1000 \
  --entrypoint bun webperf \
  /app/tooling/scripts/selfhost-database.ts restore \
  /data/restore.sqlite --database /data/webperf.sqlite
```

Restore uses a verified temporary file, makes a safety backup of the current
database by default, atomically replaces the database, and removes only exact
SQLite sidecars. It rejects a snapshot with pending migrations unless
`--allow-pending-migrations` is explicitly supplied. For an encrypted schema it
also decrypts every persisted payload with the configured current/next internal
secret before changing the live database, so a mismatched recovery key fails
before replacement. The JSON result reports `verifiedEncryptedPayloads` so the
operator can confirm how many encrypted rows were checked.

The default verification ceiling is 100,000 payloads. For a larger trusted
backup, add `--max-verify-payloads <count>` rather than bypassing verification;
restore still decrypts every row below the explicit bound before replacement.

## Restore artifacts

Restore the artifact directory from the same recovery point before starting
`webperf`. Preserve the current directory as a safety copy rather than merging
two generations. A volume-aware backup tool is preferred; if using
`docker compose cp`, make the replacement while `webperf` is stopped and
confirm ownership remains writable by UID/GID `1000`.

Startup and maintenance reconciliation retain unindexed artifact files and
directories younger than one hour. This grace window prevents a concurrent
upload that has published its file but not yet committed its SQLite row from
being mistaken for an orphan; a later maintenance pass removes true orphans.

After both parts are restored, use the saved internal secret and run:

```sh
docker compose --env-file .env -f compose.yml run --rm --no-deps \
  --user 1000:1000 \
  --entrypoint bun webperf \
  /app/tooling/scripts/selfhost-database.ts migrate \
  --database /data/webperf.sqlite --backup

docker compose --env-file .env -f compose.yml run --rm --no-deps \
  --user 1000:1000 \
  --entrypoint bun webperf \
  /app/tooling/scripts/selfhost-database.ts doctor \
  --database /data/webperf.sqlite

docker compose --env-file .env --profile browser-audit -f compose.yml up -d
```

Never run `docker compose down -v` as part of backup, upgrade, or restore. The
`-v` flag deletes the named data volume. The automated recovery drill uses it
only after checking its process-owned test project prefix, specifically to
prove that the external recovery record can reconstruct an empty volume.

For command details and older-schema recovery, see
[SQLite operations](../self-hosting/database-operations.md).
