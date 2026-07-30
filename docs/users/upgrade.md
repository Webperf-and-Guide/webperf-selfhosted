# Upgrade a WebPerf release

Treat an upgrade as a data migration, not only an image pull. The release
Compose file is digest-pinned, the API applies ordered SQLite migrations, and
an older binary refuses a database containing unknown newer migrations.

Every formal release runs `bun run drill:compose:upgrade` against two public,
checksum-verified bundles. The gate creates real multi-region Job and scheduled
Check records with `v0.2.1`, retains that release's named data volume, starts
the candidate release, and verifies the pre-migration backup, SQLite doctor,
historical region provenance, disabled unsafe schedule, explicit migration
acknowledgement, and retired Region Set surface. This automates the earliest
supported public-beta upgrade path; it does not replace an operator backup or a
staging rehearsal for custom deployments.

## 1. Prepare

1. Read the GitHub Release notes and `CHANGELOG.md`.
2. Download the new archive and verify both checksum layers.
3. Create a complete [backup](./backup-restore.md).
4. Keep the current release directory and Compose file for rollback.
5. Copy the existing `.env` into the new release directory and compare its key
   names with the new `.env.example`. Preserve all current/next secrets.

Do not replace `SELFHOST_INTERNAL_SECRET` during an upgrade. It is part of the
database encryption boundary. The automated drill intentionally keeps this
secret unchanged across both versions; a production upgrade must do the same.

### Phase 1 of issue #14: convert the region configuration before startup

Phase 1 replaced the 41-city catalog and Region Pack resources with one fixed
runtime location per deployment. The legacy configuration variables
(`SELFHOST_ACTIVE_REGION_CODES_JSON`, `SELFHOST_REGION_IDS_JSON`,
`SELFHOST_PROBE_BASE_URLS_JSON`) and the probe's `REGION_CODE`/Tokyo default
were removed from the canonical runtime configuration.

**Before starting the upgraded stack**, replace the three legacy JSON
variables in `.env` with the single-region trio:

```dotenv
SELFHOST_REGION_ID=local
SELFHOST_REGION_LABEL=
SELFHOST_PROBE_BASE_URL=http://probe:8080
```

Set `SELFHOST_REGION_ID` before running `selfhost:migrate`. The migration
refuses to rewrite a legacy saved Check when that identity is unavailable,
because it cannot safely decide whether the old Region Set matches the new
single deployment.

Set `SELFHOST_REGION_ID` to a stable identifier for this deployment's actual
location (for example `kr-seoul-office` or `aws-ap-northeast-2`). The probe
reads the same value from `REGION_ID`. The `/v1/region-packs` and
`/v1/region-sets` routes now return `410 Gone`, and the Console `/regions`
page reports the single runtime location instead of a city catalog.

The upgrade migration preserves published beta data rather than assigning old
measurements to the new deployment location:

- a historical Job with one selected region keeps that original region;
- a historical Job with several selected regions keeps every target and the
  original region list, and uses `historical-multi-region` only as its
  top-level aggregate identifier;
- a saved Check whose old Region Set contains exactly the configured
  `SELFHOST_REGION_ID` is migrated and records that decision;
- a saved Check whose Region Set is multi-region, missing, or different from
  the configured runtime has its schedule disabled and reports
  `locationMigration.status = requires_review`.

For a Check that requires review, open **Checks**, edit the saved Check, confirm
that it should now run only from this deployment, and save it. The API requires
the explicit `acknowledgeLocationMigration` update flag, so old scheduled or
manual behavior cannot silently collapse from several regions to one. Legacy
Region Set rows remain encrypted in SQLite for recovery compatibility, but
they are not exposed as a current operator workflow.

### Migrate to the two-container default runtime

The four Bun runtime images (`webperf-console`, `webperf-api`,
`webperf-scheduler`, `webperf-executor`) were first consolidated into one
multi-role `webperf` image. The default release topology now goes further:
`WEBPERF_ROLE=standalone` supervises console, API, embedded scheduler, and
executor in one container. `webperf-probe` stays separate, so the normal
installation has two containers. The optional Lighthouse Browser Audit runner
is a third profile container.

**Before starting the upgraded stack**, replace any
`webperf-console`/`webperf-api`/`webperf-scheduler`/`webperf-executor` services
in your Compose file or release directory with the single `webperf` service.
The release bundle's `compose.yml` already reflects this. Operators maintaining
a custom Compose file should copy that complete service stanza. At minimum, the
standalone supervisor requires the following exact identity and capability
boundary in addition to `WEBPERF_ROLE=standalone`:

```yaml
services:
  webperf:
    init: true
    user: "0:0"
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - KILL
      - SETGID
      - SETUID
    stop_grace_period: 16m
    environment:
      WEBPERF_ROLE: standalone
```

The root process is a network-inert supervisor only. It uses those three
capabilities to launch the console, API, and executor under separate non-root
UIDs and to stop them cleanly. Omitting the explicit root supervisor identity
or any required capability makes standalone startup fail closed.

If you previously relied on a standalone scheduler container, either remove it
and accept the default embedded mode, or retain the optional split scheduler
role and set `SELFHOST_SCHEDULER_MODE=external` on `webperf`. Split console,
API, scheduler, and executor roles remain available for custom development and
maintenance topologies, but they are not the default release layout. The probe
(`webperf-probe`) and optional Lighthouse runner
(`webperf-browser-audit-lighthouse`) images are unchanged.

## 2. Stop the old topology, then pull

First return to the **currently running release directory** and stop its
services using its existing Compose file. `down` removes the old containers and
networks but deliberately retains the named `webperf-data` volume because this
command does not use `-v`:

```sh
docker compose --env-file .env --profile browser-audit -f compose.yml \
  down --remove-orphans --timeout 30
```

Confirm that the old `console`, `api`, `executor`, and optional worker
containers are no longer running. Then enter the new release directory,
validate its copied `.env`, and pull the digest-pinned replacement:

```sh
docker compose --env-file .env -f compose.yml config --quiet
docker compose --env-file .env -f compose.yml pull
```

The fixed Compose project name lets the new topology reattach the retained
`webperf-data` volume. Never add `-v` to this upgrade command.

## 3. Migrate and diagnose

Run migrations in a one-off `webperf` container before starting concurrent writers:

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
