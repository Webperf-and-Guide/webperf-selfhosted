# SQLite operations

WebPerf keeps SQLite as the default and only required database for the
self-hosted public beta. The API enables WAL mode, a 5-second busy timeout,
foreign-key enforcement, and `NORMAL` synchronous mode on writable
connections. Ordered migrations are recorded in `schema_migrations` and an
older binary refuses to open a database containing unknown newer migrations.

## Local process commands

Commands use `SELFHOST_DATABASE_PATH` or `./data/webperf.sqlite` by default.
Migrations also require the same `SELFHOST_INTERNAL_SECRET` (and optional
`SELFHOST_INTERNAL_SECRET_NEXT`) that can decrypt existing payloads.

```sh
SELFHOST_INTERNAL_SECRET='replace-with-your-secret' bun run selfhost:migrate
bun run selfhost:doctor
bun run selfhost:backup -- --output ./backups/webperf.sqlite
bun run selfhost:maintenance
bun run selfhost:maintenance -- --vacuum
```

Useful options:

- `--database <path>` selects an explicit database.
- `selfhost:migrate -- --backup` creates a verified snapshot before applying
  pending migrations to an existing database.
- `SELFHOST_MIGRATION_BACKUP=true` enables the same pre-migration backup when
  the API starts and applies migrations automatically.
- `selfhost:maintenance -- --retention-days <days>` overrides
  `SELFHOST_RETENTION_DAYS`; `--vacuum` opts into the blocking full compaction.
- `selfhost:maintenance -- --artifacts <path>` selects an artifact root when it
  differs from `SELFHOST_ARTIFACTS_PATH`.

`selfhost:maintenance` removes expired terminal jobs, Check run history,
terminal execution rows, derived resources, and orphaned artifact indexes and
files. It preserves non-terminal jobs
and Browser Audits that still have queued or leased execution work. It always
runs `PRAGMA optimize` and truncates the WAL; full `VACUUM` is explicit because
it needs additional free disk space and takes an exclusive write lock.

## Backup

`selfhost:backup` uses SQLite `VACUUM INTO`, so the output is a consistent,
compacted snapshot that includes committed WAL-visible data. It refuses to
overwrite an existing file, sets mode `0600`, and runs `PRAGMA integrity_check`
plus `PRAGMA foreign_key_check` before reporting success.

Keep backups outside the live data volume and protect them like production
secrets: a backup made before the encrypted-payload migration can contain
legacy cleartext values.

The SQLite backup contains artifact metadata but not artifact bytes. Back up
`SELFHOST_ARTIFACTS_PATH` separately as part of the same stopped-writer recovery
point. See [Browser Audit artifact storage](./artifacts.md).

## Restore

Stop every writer before restore. Restore verifies the source, creates a safety
backup of the current database by default, verifies a temporary snapshot, then
atomically replaces the database and removes exact SQLite sidecar files.

```sh
bun run selfhost:restore -- ./backups/webperf.sqlite
```

Use `--no-backup` only when a separate verified copy of the current database
already exists. Restore rejects snapshots with pending migrations by default.
For an intentional older-schema recovery, add `--allow-pending-migrations`;
the command reports the exact pending IDs. Immediately run `selfhost:migrate`,
then `selfhost:doctor`, before restarting the stack.

## Docker Compose

Online backup and diagnostics can run inside the API container so they see the
named `/data` volume:

```sh
docker compose \
  --env-file infra/docker-compose/.env \
  -f infra/docker-compose/docker-compose.yml \
  exec api bun /app/tooling/scripts/selfhost-database.ts backup \
  --database /data/webperf.sqlite --output /data/webperf-backup.sqlite

docker compose \
  --env-file infra/docker-compose/.env \
  -f infra/docker-compose/docker-compose.yml \
  exec api bun /app/tooling/scripts/selfhost-database.ts doctor \
  --database /data/webperf.sqlite
```

For restore, stop the API, scheduler, and executor first and use a one-off API
container attached to the same volume:

```sh
docker compose \
  --env-file infra/docker-compose/.env \
  -f infra/docker-compose/docker-compose.yml \
  stop scheduler executor api

docker compose \
  --env-file infra/docker-compose/.env \
  -f infra/docker-compose/docker-compose.yml \
  run --rm --no-deps --entrypoint bun api \
  /app/tooling/scripts/selfhost-database.ts restore \
  /data/webperf-backup.sqlite --database /data/webperf.sqlite
```

Run the migration and doctor commands in the same one-off form before bringing
the services back up.
