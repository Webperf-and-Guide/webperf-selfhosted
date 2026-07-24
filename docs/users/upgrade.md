# Upgrade a WebPerf release

Treat an upgrade as a data migration, not only an image pull. The release
Compose file is digest-pinned, the API applies ordered SQLite migrations, and
an older binary refuses a database containing unknown newer migrations.

## 1. Prepare

1. Read the GitHub Release notes and `CHANGELOG.md`.
2. Download the new archive and verify both checksum layers.
3. Create a complete [backup](./backup-restore.md).
4. Keep the current release directory and Compose file for rollback.
5. Copy the existing `.env` into the new release directory and compare its key
   names with the new `.env.example`. Preserve all current/next secrets.

Do not replace `SELFHOST_INTERNAL_SECRET` during an upgrade. It is part of the
database encryption boundary.

## 2. Pull and stop

From the new release directory:

```sh
docker compose --env-file .env -f compose.yml config --quiet
docker compose --env-file .env -f compose.yml pull
docker compose --env-file .env --profile browser-audit -f compose.yml stop
```

The fixed Compose project name keeps the existing `webperf-data` volume. Do not
add `-v` to any stop or down command.

## 3. Migrate and diagnose

Run migrations in a one-off API container before starting concurrent writers:

```sh
docker compose --env-file .env -f compose.yml run --rm --no-deps \
  --entrypoint bun api \
  /app/tooling/scripts/selfhost-database.ts migrate \
  --database /data/webperf.sqlite --backup

docker compose --env-file .env -f compose.yml run --rm --no-deps \
  --entrypoint bun api \
  /app/tooling/scripts/selfhost-database.ts doctor \
  --database /data/webperf.sqlite
```

Do not continue if migration or doctor reports pending, unknown, integrity, or
foreign-key failures. Preserve the generated pre-migration backup.

## 4. Start and verify

```sh
docker compose --env-file .env -f compose.yml up -d
# Add --profile browser-audit if it was enabled before the upgrade.
docker compose --env-file .env -f compose.yml ps
curl --fail http://127.0.0.1:5173/
```

Run one manual Fast Check, inspect scheduler and executor logs, confirm prior
Runs and baselines are readable, and launch a Browser Audit if that profile is
enabled.

## Rollback

If no migration was applied, stop the new services and restart the previous
digest-pinned Compose file with the same `.env` and volume.

If a migration was applied, do not point an older image at the upgraded
database. Stop all writers, restore the pre-upgrade SQLite snapshot and its
matching artifact snapshot, then start the old release. Forward-schema refusal
is a safety feature; bypassing it risks irreversible corruption.
