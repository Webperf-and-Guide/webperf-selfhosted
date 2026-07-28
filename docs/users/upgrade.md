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

### Phase 1 of issue #14: convert the region configuration before startup

Phase 1 replaced the 41-city catalog and Region Pack resources with one fixed
runtime location per deployment. The legacy configuration variables
(`SELFHOST_ACTIVE_REGION_CODES_JSON`, `SELFHOST_REGION_IDS_JSON`,
`SELFHOST_PROBE_BASE_URLS_JSON`) and the probe's `REGION_CODE`/Tokyo default
were removed without a compatibility parser because there is no production
data to preserve.

**Before starting the upgraded stack**, replace the three legacy JSON
variables in `.env` with the single-region trio:

```dotenv
SELFHOST_REGION_ID=local
SELFHOST_REGION_LABEL=
SELFHOST_PROBE_BASE_URL=http://probe:8080
```

Set `SELFHOST_REGION_ID` to a stable identifier for this deployment's actual
location (for example `kr-seoul-office` or `aws-ap-northeast-2`). The probe
reads the same value from `REGION_ID`. The `/v1/region-packs` and
`/v1/region-sets` routes now return `410 Gone`, and the Console `/regions`
page reports the single runtime location instead of a city catalog.

### Phase 2+3 of issue #14: migrate to the three-image runtime set

Phase 2+3 consolidated the four Bun runtime images (`webperf-console`,
`webperf-api`, `webperf-scheduler`, `webperf-executor`) into a single
multi-role `webperf` image. The active role is selected at container start by
the `WEBPERF_ROLE` environment variable (`console`, `api`, `scheduler`, or
`executor`) through the `tooling/scripts/webperf-role.ts` dispatcher, so all
four services now share one image. The scheduler also defaults to embedded
mode inside the API process (`SELFHOST_SCHEDULER_MODE=embedded`); external mode
remains available for operators who want to keep the dispatch loop in its own
container.

**Before starting the upgraded stack**, replace any
`webperf-console`/`webperf-api`/`webperf-scheduler`/`webperf-executor` image
references in your Compose file or release directory with the single `webperf`
image, and set `WEBPERF_ROLE` on each of those services. The release bundle's
`compose.yml` already reflects this; operators maintaining a custom Compose
file should mirror the same mapping:

```dotenv
# console service
WEBPERF_ROLE=console
# api service
WEBPERF_ROLE=api
# scheduler service (only needed if you keep SELFHOST_SCHEDULER_MODE=external)
WEBPERF_ROLE=scheduler
# executor service
WEBPERF_ROLE=executor
```

If you previously relied on a standalone scheduler container, either remove it
and accept the default embedded mode, or keep it and set
`SELFHOST_SCHEDULER_MODE=external` on the API service. The probe
(`webperf-probe`) and optional Lighthouse runner
(`webperf-browser-audit-lighthouse`) images are unchanged.

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
