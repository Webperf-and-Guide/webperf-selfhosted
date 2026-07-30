# Configure WebPerf self-hosted

The release `.env.example` is the complete Compose configuration surface. Keep
the active `.env` file outside source control, mode `0600`, and backed up with
the encryption secret needed by the matching database.

## Required secret groups

| Variable | Used by | Purpose |
| --- | --- | --- |
| `SELFHOST_ADMIN_TOKEN` | Console and API | Operator data and execution access |
| `SELFHOST_INTERNAL_SECRET` | API, scheduler, executor | Internal API authentication and SQLite payload encryption |
| `PROBE_SHARED_SECRET` | Executor and probe | HMAC-authenticated measurements |
| `BROWSER_AUDIT_SHARED_SECRET` | Executor and optional runner | HMAC-authenticated Browser Audit requests |

Every current secret must contain at least 16 characters. Production startup
has no shared fallback. The console uses the administrator token only on its
server side; it must never be injected into browser JavaScript or a reverse
proxy configuration.

Each secret has an optional `_NEXT` counterpart. Current and next values are
accepted during a transition, while new encrypted payloads use
`SELFHOST_INTERNAL_SECRET`. For an internal-secret rotation, promote the new
value to current and keep the old value in `SELFHOST_INTERNAL_SECRET_NEXT`
until every retained encrypted record has been rewritten or expired. The
public beta does not ship a bulk re-key command, so removing the old decryption
key early can make existing rows unreadable.

## Console and service origins

- `CONSOLE_ORIGIN` is the browser-visible origin. Set the final HTTPS origin
  when using a reverse proxy.
- `CONSOLE_PUBLIC_PORT` changes the loopback host port.
- The default `standalone` supervisor pins console and executor API calls to
  the configured API bind address inside the `webperf` container. Wildcard
  binds use loopback for those child-process calls.
- `WEBPERF_STANDALONE_STARTUP_TIMEOUT_MS=0` keeps waiting while the API process
  remains alive, so long first-start migrations and artifact reconciliation
  can finish. Set a positive millisecond deadline only when the operator
  explicitly prefers fail-closed startup.
- `SELFHOST_SCHEDULER_API_BASE_URL=http://webperf:8788` is only used by the
  optional `external-scheduler` profile.
- Non-loopback plain HTTP for the executor API requires the explicit
  `SELFHOST_EXECUTOR_ALLOW_INSECURE_API_HTTP=true` trusted-network opt-in; use
  HTTPS for remote API origins.
- `SELFHOST_ARTIFACT_UPLOAD_BASE_URL=http://webperf:8788` is the credential-free
  origin the optional runner uses for scoped artifact uploads.
- Webhook targets require HTTPS. Set
  `SELFHOST_EXECUTOR_ALLOW_INSECURE_WEBHOOK_HTTP=true` only for a legacy public
  HTTP endpoint; public-address pinning and redirect blocking remain enabled.

These base URLs must be HTTP(S) origins without embedded credentials, paths,
queries, or fragments.

## Persistence and retention

- `SELFHOST_DATABASE_PATH=/data/webperf.sqlite` selects the SQLite file.
- `SELFHOST_ARTIFACTS_PATH=/data/artifacts` selects the local artifact root.
- `SELFHOST_RETENTION_DAYS=30` controls terminal history and artifact cleanup.
- `SELFHOST_MAX_ARTIFACT_BYTES=25000000` is a per-file limit, with a hard
  maximum of 250 MB.
- `SELFHOST_ARTIFACT_UPLOAD_TTL_SECONDS=900` must be between 60 and 3,600.
- `SELFHOST_MIGRATION_BACKUP=true` creates a verified database snapshot before
  startup applies pending migrations to an existing file.

SQLite and artifacts share the default named volume but have different backup
semantics. Read [Backup and restore](./backup-restore.md).

## Runtime location and execution

One standalone deployment measures from one fixed runtime location:

```dotenv
SELFHOST_REGION_ID=local
SELFHOST_REGION_LABEL=
SELFHOST_PROBE_BASE_URL=http://probe:8080
```

`SELFHOST_REGION_ID` is the stable serialized identifier (1–64 lowercase
ASCII letters, digits, or hyphens). `SELFHOST_REGION_LABEL` is the optional
display name. `SELFHOST_PROBE_BASE_URL` is the credential-free HTTP(S)
origin of the Rust probe. Read [Configure the runtime location](./regions.md)
for the full remote-probe walkthrough.

`SELFHOST_MAX_TARGET_ATTEMPTS` is capped at 20. Insecure HTTP probe and
browser origins are allowed only for the private default Compose networks;
remote runtimes should use HTTPS and disable the corresponding
`SELFHOST_EXECUTOR_ALLOW_INSECURE_*` override.

## Resource and log limits

`compose.yml` supplies conservative CPU and memory defaults plus JSON log
rotation. Uncomment the `*_CPU_LIMIT`, `*_MEMORY_LIMIT`,
`WEBPERF_LOG_MAX_SIZE`, and `WEBPERF_LOG_MAX_FILES` values only after measuring
the host. Browser auditing is the most memory-intensive service.

## Apply changes safely

```sh
docker compose --env-file .env -f compose.yml config --quiet
docker compose --env-file .env -f compose.yml up -d
docker compose --env-file .env -f compose.yml ps
```

Changing `SELFHOST_INTERNAL_SECRET`, storage paths, region maps, or runtime
origins deserves a backup and maintenance window. Never use `docker compose
down -v` on a production installation; `-v` deletes the named data volume.
