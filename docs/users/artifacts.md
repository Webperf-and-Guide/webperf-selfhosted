# Manage Browser Audit artifacts

The public beta ships one artifact backend: a traversal-safe local filesystem.
SQLite stores only the index—ownership, kind, filename, content type, size,
SHA-256 digest, storage key, and creation time. Artifact bytes are never stored
as SQLite BLOBs.

## Storage settings

```dotenv
SELFHOST_ARTIFACTS_PATH=/data/artifacts
SELFHOST_ARTIFACT_UPLOAD_BASE_URL=http://api:8788
SELFHOST_MAX_ARTIFACT_BYTES=25000000
SELFHOST_ARTIFACT_UPLOAD_TTL_SECONDS=900
SELFHOST_RETENTION_DAYS=30
```

The per-file limit is capped at 250 MB. Upload grants last between 60 seconds
and one hour. One audit can index at most 50 files.

An upload is accepted only when its token, audit, execution job, lease owner,
lease attempt, kind-specific content type, declared size, filename, and
generated storage key all agree. Stale or cross-audit grants are rejected.

## Download

Artifacts are downloaded through the console or the administrator-authenticated
API route. Responses are attachments with `nosniff`, a digest-based ETag, and
`no-store`. Descriptor-backed downloads stream without reopening the validated
path; `X-WebPerf-Artifact-Bytes` carries the verified size because Bun serves
these streams with chunked transfer encoding. The console adds the
administrator token server-side; the browser does not receive it.

Missing bytes for an indexed file are reported as unavailable rather than
silently replaced. Verify the displayed SHA-256 digest when moving an artifact
into another evidence store.

## Retention

At API startup and during `selfhost:maintenance`, WebPerf removes expired
artifact index rows and reconciles the filesystem against the remaining index.
The cleanup root cannot be a filesystem root, does not follow symlinks, and
requires process-owned, owner-only directories. Download and delete operations
keep the validated audit-directory descriptor pinned and reject directory
identity changes. In the Compose deployment, only the API service mounts the
artifact volume. Cleanup removes only unindexed entries below the configured
directory.

From a source checkout, maintenance can be run directly. In a release
container, use the shipped script:

```sh
docker compose --env-file .env -f compose.yml exec api \
  bun /app/tooling/scripts/selfhost-database.ts maintenance \
  --database /data/webperf.sqlite --artifacts /data/artifacts
```

Add `--retention-days <days>` to override the configured window for that run.
If database retention succeeds but filesystem reconciliation cannot complete,
the command exits non-zero with `partial: true`, preserves the committed
database cleanup counts, and reports the artifact-stage error separately.
Correct the artifact root or permissions and rerun maintenance.

## Backup boundary

A SQLite backup contains artifact metadata but not bytes. A valid recovery
point must capture the verified SQLite snapshot and the entire artifact
directory while API and executor writers are stopped. Restore the matching
pair. Startup reconciliation removes unindexed files, so mixing database and
artifact snapshots from different times can lose evidence.

See [Backup and restore](./backup-restore.md) and the detailed
[artifact storage contract](../self-hosting/artifacts.md).
