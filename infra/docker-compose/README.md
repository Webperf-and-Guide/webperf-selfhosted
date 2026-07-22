# Compose Bundle

This directory contains two Compose layers:

- `compose.yml` is the repository production source and consumes one versioned
  GHCR tag across every WebPerf service. Tagged release downloads rewrite
  those references to immutable OCI digests.
- `compose.dev.yml` overrides those images with builds from the current source
  checkout.

The default stack runs `console`, `api`, `scheduler`, `executor`, and `probe`.
Only the console is published, on `127.0.0.1:5173`. API, probe, scheduler, and
executor traffic stays on segmented Compose networks.

## Production Start

Generate random credentials, confirm `WEBPERF_VERSION`, then start the tagged
images:

```sh
bun run selfhost:init
docker compose \
  --env-file infra/docker-compose/.env \
  -f infra/docker-compose/compose.yml \
  up -d
```

Open `http://localhost:5173`. The persistent volume `webperf-data` owns both
the SQLite database and Browser Audit artifacts below `/data`.

For an operator install, prefer the `compose.yml` and `.env.example` from a
GitHub Release bundle. That Compose file is digest-pinned and does not require
`WEBPERF_VERSION`.

## Source-Build Start

Use both files when validating local changes:

```sh
docker compose \
  --env-file infra/docker-compose/.env \
  -f infra/docker-compose/compose.yml \
  -f infra/docker-compose/compose.dev.yml \
  up -d --build
```

## Optional Browser Audit

Set `SELFHOST_BROWSER_AUDIT_BASE_URL=http://browser-audit-lighthouse:8080`, then
enable the optional profile:

```sh
docker compose \
  --env-file infra/docker-compose/.env \
  --profile browser-audit \
  -f infra/docker-compose/compose.yml \
  up -d
```

The Lighthouse reference runner stays off the host network, runs one audit at
a time, uses a 1 GiB shared-memory allocation, and keeps the Chrome sandbox
enabled without adding `SYS_ADMIN`. Compose applies the checked-in
`browser-audit-seccomp.json`, which is based on Moby's `seccomp/v0.2.1`
default profile and adds only the `clone`, `setns`, and `unshare` permissions
recommended for a non-root Chromium user-namespace sandbox. The vendored
Apache-2.0 source is Moby `default.json` blob
`ea5a494afb8d64898fa0f4f47ae0c4f5ba9cbbc9`.

## Loopback Debug Profile

Start only the API debug proxy when direct API access is necessary:

```sh
docker compose \
  --env-file infra/docker-compose/.env \
  --profile debug \
  -f infra/docker-compose/compose.yml \
  up -d api-debug
```

This temporarily publishes the API at `127.0.0.1:8788`. To inspect the optional
runner, first start its `browser-audit` profile and then start
`browser-audit-debug`; that proxy binds `127.0.0.1:8081`. Neither debug proxy
binds a non-loopback interface.

All production services have health checks, restart and stop policies, log
rotation, non-root users, and configurable CPU/memory ceilings. Services are
read-only except for explicit tmpfs mounts and the API's `/data` volume.

See [Docker Compose install](../../docs/quickstart/local-compose.md),
[authentication and secrets](../../docs/security/auth-and-secrets.md), and
[Browser Audit sandboxing](../../docs/self-hosting/browser-audit-lighthouse.md).
