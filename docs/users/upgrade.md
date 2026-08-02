# Upgrade a WebPerf release

Treat an upgrade as a data migration, not only an image pull. The release
Compose file is digest-pinned, the API applies ordered SQLite migrations, and
an older binary refuses a database containing unknown newer migrations.

Every formal release newer than `v0.4.0` runs the Compose upgrade drill against
two public, checksum-verified bundles. The gate starts the supported `v0.4.0`
baseline, creates a Site, Route Group, Check, and
completed Job, stops the baseline writers, creates and verifies an explicit
SQLite backup, retains the named data volume, starts the candidate release, and
verifies SQLite doctor, every stored relationship, result provenance, and a new
post-upgrade Check run. This proves the supported consolidated-runtime upgrade
path; the drill backup remains inside its disposable test volume, so it does
not replace an operator's off-volume backup or a staging rehearsal for custom
deployments.

Direct in-place upgrades are supported from `v0.4.0` or newer. Releases through
`v0.3.0` used superseded runtime layouts, and the split-role GHCR packages used
by `v0.2.x` are retired. Their archived bundles are not a supported starting
point for the automated upgrade path. If an older deployment still exists,
preserve its database, artifacts, environment, and locally cached images, then
rehearse the data move into a current installation before changing production.

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

### Keep the supported runtime identity stable

`v0.4.0` and later use one consolidated `webperf` container plus
`webperf-probe`; the optional Lighthouse runner is a third profile container.
Keep the deployment's stable runtime location and internal service origins in
the copied environment:

```dotenv
SELFHOST_REGION_ID=your-existing-stable-location
SELFHOST_REGION_LABEL=
SELFHOST_PROBE_BASE_URL=http://probe:8080
SELFHOST_ARTIFACT_UPLOAD_BASE_URL=http://webperf:8788
SELFHOST_SCHEDULER_API_BASE_URL=http://webperf:8788
```

Changing `SELFHOST_REGION_ID` changes result provenance and can make saved
Checks require operator review. If you maintain a custom Compose file, compare
the complete `webperf`, `probe`, volume, security, and network definitions with
the new release instead of changing only image references.

## 2. Stop the old topology, then pull

First return to the **currently running release directory** and stop its
services using its existing Compose file. `down` removes the old containers and
networks but deliberately retains the named `webperf-data` volume because this
command does not use `-v`:

```sh
docker compose --env-file .env --profile browser-audit -f compose.yml \
  down --remove-orphans --timeout 30
```

Confirm that `webperf`, `probe`, and the optional Lighthouse container are no
longer running. Then enter the new release directory,
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
