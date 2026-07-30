# Browser Audit artifact storage

WebPerf persists Browser Audit files in a local filesystem store by default.
SQLite stores only the artifact index: audit ownership, registry kind,
normalized filename, content type, byte size, SHA-256 digest, storage key, and
creation time. Artifact bytes are never stored in a SQLite BLOB.
The repository validates index metadata against the public artifact contracts
before every write and again when reading persisted rows.

## Configuration

- `SELFHOST_ARTIFACTS_PATH` defaults to `./data/artifacts`; Compose uses
  `/data/artifacts` in the same private `webperf-data` volume as SQLite.
- `SELFHOST_ARTIFACT_UPLOAD_BASE_URL` is the credential-free API origin that
  the runner can reach. Compose uses `http://webperf:8788`.
- `SELFHOST_MAX_ARTIFACT_BYTES` defaults to `25000000` per file and is capped
  at `250000000`.
- `SELFHOST_ARTIFACT_UPLOAD_TTL_SECONDS` defaults to `900` and is capped at one
  hour.

The executor retrieves a transient grant from a dedicated internal endpoint;
the general execution context does not contain upload credentials. The API
issues the runner a signed upload token scoped to one audit, one execution job,
and the current lease owner. Uploads also require a live lease,
lease attempt, an allowed kind-specific content type, an exact declared byte
size, a normalized filename, and a traversal-safe generated storage key. A
stale, reclaimed, tampered, or cross-audit token is rejected. One audit may
index at most 50 files.

## Download

`GET /v1/browser-audits/:auditId/artifacts/:artifactId` streams the indexed file
and requires `SELFHOST_ADMIN_TOKEN`, like other data resources. The console
proxies this request server-side so the administrator token is never exposed to
browser JavaScript. Responses use `Content-Disposition: attachment`,
`X-Content-Type-Options: nosniff`, a digest-based ETag, and `no-store`.

## Retention and maintenance

API startup applies `SELFHOST_RETENTION_DAYS`, removes artifact index rows whose
Browser Audit expired, then reconciles the filesystem against the remaining
index. `bun run selfhost:maintenance` performs the same reconciliation; use
`--artifacts <path>` when it differs from `SELFHOST_ARTIFACTS_PATH`.

The reconciliation root may not be a filesystem root. It does not follow
symlinks. The API requires the root and managed audit directories to be owned
by its effective user and makes them owner-only (`0700`). It pins a validated
audit-directory descriptor across write, download, and delete operations.
Linux accesses entries asynchronously through `/proc/self/fd/<directory-fd>`;
macOS uses cached POSIX `openat`, `linkat`, and `unlinkat` bindings. Temporary
creation, no-replace publication, reads, and cleanup all stay relative to the
pinned descriptor, and the store rejects a path whose directory identity
changes during the operation. This local backend supports Linux and macOS,
including glibc- and musl-based Linux images. Compose mounts the
`webperf-data` volume only into the supervised `webperf` service; Browser Audit
runtimes do not receive filesystem access to it. At the root, reconciliation
owns only names that match the generated artifact-ID namespace, so filesystem
or deployment entries such as `lost+found` and `.gitkeep` are preserved. It
removes unindexed entries inside managed audit directories after the
reconciliation grace period. A zero-length grace is rejected unless the caller
also supplies an explicit immediate-deletion opt-in; normal startup and
maintenance flows always retain the one-hour safety window.

## Backup boundary

`selfhost:backup` backs up SQLite metadata, not artifact bytes. For a complete
recovery point, stop API/executor writers and back up both the SQLite snapshot
and `SELFHOST_ARTIFACTS_PATH`. Restore the matching pair before startup; missing
indexed files are reported as unavailable, while unindexed files inside managed
audit directories are removed by reconciliation.

The storage boundary is an explicit adapter interface. Local filesystem is the
only shipped backend in the public beta; an S3-compatible implementation can be
added later without changing the Browser Audit Protocol or persisted public
artifact references.
