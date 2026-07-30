# Compose Bundle

This directory contains two Compose layers:

- `compose.yml` is the repository production source and consumes one versioned
  GHCR tag across every WebPerf service. Tagged release downloads rewrite
  those references to immutable OCI digests.
- `compose.dev.yml` overrides those images with builds from the current source
  checkout.

The default stack runs `webperf` and `probe`. The supervised `webperf`
container owns the console, API, embedded scheduler, and durable executor.
Only its console port is published, on `127.0.0.1:5173`; API and probe traffic
stays on segmented Compose networks.

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

`selfhost:init` copies the checked-in template whose `WEBPERF_VERSION` is
validated against root `VERSION`; automated release preparation advances both
together.

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
enable the optional profile. On AppArmor 4 hosts such as Ubuntu 24.04, first
load the checked-in profile and include the host-specific overlay:

```sh
sudo apparmor_parser -r -W infra/docker-compose/browser-audit.apparmor

docker compose \
  --env-file infra/docker-compose/.env \
  --profile browser-audit \
  -f infra/docker-compose/compose.yml \
  -f infra/docker-compose/compose.apparmor.yml \
  up -d
```

Omit `compose.apparmor.yml` on hosts without AppArmor user-namespace
restrictions.

The Lighthouse reference runner stays off the host network, runs one audit at
a time, uses a 1 GiB shared-memory allocation, and keeps the Chrome sandbox
enabled without adding `SYS_ADMIN`. Compose drops all capabilities and restores
only `SYS_CHROOT`, which Chromium needs to enter its sandbox root. It also
applies the checked-in `browser-audit-seccomp.json`, which is based on Moby's
`seccomp/v0.2.1` default profile and adds only the `clone`, `setns`, and
`unshare` permissions recommended for a non-root Chromium user-namespace
sandbox. The vendored Apache-2.0 source is Moby `default.json` blob
`ea5a494afb8d64898fa0f4f47ae0c4f5ba9cbbc9`. Following Chromium's AppArmor 4
guidance, the host overlay selects an unconfined profile with the explicit
`userns` permission only for this service. It does not disable AppArmor
globally; runtime confinement remains enforced by the default-deny seccomp
profile, non-root UID, minimal capability set, no-new-privileges, read-only
filesystem, private network, and Chromium's own sandbox.

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
binds a non-loopback interface. Debug proxy requests have an 8 MiB body limit;
oversized requests receive `413` before any upstream call.

All production services have health checks, restart and stop policies, log
rotation, non-root users, and configurable CPU/memory ceilings. Services are
read-only except for explicit tmpfs mounts and the API's `/data` volume.
`bun run compose:config` also requires non-zero numeric UID and GID values and
the exact same service/security surface in the development override.

See [Docker Compose install](../../docs/quickstart/local-compose.md),
[authentication and secrets](../../docs/security/auth-and-secrets.md), and
[Browser Audit sandboxing](../../docs/self-hosting/browser-audit-lighthouse.md).
