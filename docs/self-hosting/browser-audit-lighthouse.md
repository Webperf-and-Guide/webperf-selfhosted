# Browser Audit Worker

`apps/browser-audit-lighthouse` is an optional self-host runtime.

It is the OSS source of truth for the Bun-first browser-audit container used by both:

- self-host operators who want to run the worker directly
- the managed cloud product, which consumes the published image and adds orchestration around it

What it does not include:

- queueing or persistence
- managed artifact retention
- Bunny or Cloudflare fleet control

## Runtime Profile

Current tested quartet:

- Bun: `1.3.13`
- amd64 browser: Chrome for Testing `146.0.7680.153`, pinned as the Docker
  `CHROME_VERSION` default and kept aligned with `puppeteer-core` `24.40.0`
- arm64 browser: Debian Chromium `146.0.7680.153-1~deb13u1`, installed from
  the immutable `20260320T220114Z` Debian security snapshot and checked against
  the same `CHROME_VERSION`
- Puppeteer: `24.40.0`
- Lighthouse: `13.1.0`

The worker exposes the active runtime versions through `GET /capabilities`.

## Local Run

```bash
bun run dev:browser-audit-lighthouse
```

Default address:

```text
http://127.0.0.1:8081
```

Useful environment variables:

- `HOST`
- `PORT`
- `CHROME_EXECUTABLE_PATH`
- `CHROME_INSTALL_DIR`
- `BROWSER_AUDIT_SHARED_SECRET`
- `BROWSER_AUDIT_SHARED_SECRET_NEXT`
- `BROWSER_AUDIT_ALLOW_NO_SANDBOX`

## Self-Hosted Queued Execution

The worker stays optional. Configure its origin and signing key for the
executor:

- `SELFHOST_BROWSER_AUDIT_BASE_URL`
- `BROWSER_AUDIT_SHARED_SECRET`

That enables the public self-host resources:

- `GET /v1/browser-audits`
- `POST /v1/browser-audits`
- `GET /v1/browser-audits/:id`
- `GET /v1/browser-audits/:id/artifacts/:artifactId`

`POST /v1/browser-audits` returns a queued resource. The durable executor calls
the runner, retries transient unavailability, and persists:

- execution status
- summary metrics
- failure reason
- artifact metadata and pointers
- artifact bytes in the configured self-host artifact store

It intentionally does not add:

- managed queue/fleet/provider orchestration
- SaaS tenancy or hosted retention rules

Provider-specific deployment walkthroughs for this worker belong on `webperf.and.guide`. The OSS docs stay focused on the worker as a portable optional runtime.

## Optional Compose Profile

The worker is not part of the default Compose boot path.

To start it:

```bash
docker compose \
  --env-file infra/docker-compose/.env \
  --profile browser-audit \
  -f infra/docker-compose/compose.yml \
  up -d
```

Set `BROWSER_AUDIT_SHARED_SECRET` in `infra/docker-compose/.env` when you want
the executor and worker to authenticate signed requests.
The default `.env.example` leaves `SELFHOST_BROWSER_AUDIT_BASE_URL` empty, so
the default Compose stack does not advertise Browser Audit until the optional
profile is deliberately enabled.

Set `SELFHOST_BROWSER_AUDIT_BASE_URL=http://browser-audit-lighthouse:8080` when
enabling the profile. The worker remains on its dedicated Compose network and
does not publish a host port. On amd64, the image installs the explicitly pinned
Chrome for Testing revision at `/opt/google/chrome/chrome`, matching Ubuntu's
Chrome AppArmor profile path. Packaged sandbox helpers remain non-setuid and
the runner explicitly selects Chromium's user-namespace sandbox. Compose
applies `no-new-privileges` and a default-deny seccomp profile derived from Moby
`seccomp/v0.2.1` with only `clone`, `setns`, and `unshare` added for Chromium's
user-namespace sandbox; the production profile does not add `SYS_ADMIN`.

## Docker Build

Build from the `webperf-selfhosted` repo root:

```bash
docker build \
  -f apps/browser-audit-lighthouse/Dockerfile \
  -t webperf-browser-audit-lighthouse:dev \
  .
```

## Supported Flow DSL

Supported setup steps:

- `setViewport`
- `setCookie`
- `setExtraHeaders`

Supported interactive steps:

- `navigate`
- `waitForSelector`
- `waitForUrl`
- `click`
- `type`
- `press`
- `select`
- `waitForTimeout`

Supported checkpoints:

- `navigate`
- `snapshot`
- `timespanStart`
- `timespanEnd`

Current limits:

- max 20 steps
- max 3 checkpoints total
- max 1 page
- max 1 browser context
- default total timeout `120000ms`
- default per-step timeout `10000ms`

## Artifact Behavior

Supported artifacts:

- Lighthouse JSON
- Lighthouse HTML
- full-page screenshot
- trace upload

The worker request/response contracts and artifact references live in `@webperf/contracts`.
The API issues an execution-scoped, short-lived upload token; the worker never
receives the administrator token or the internal service secret. The default
store writes below `SELFHOST_ARTIFACTS_PATH`, keeps only metadata and SHA-256
digests in SQLite, and streams downloads through the authenticated API and
console. See [artifact storage](./artifacts.md).

## Runtime Notes

Recommended container behavior:

- one in-flight audit per worker
- fresh browser/page per audit
- worker process stays warm for sequential audits
- no `--no-sandbox` by default
- only allow `--no-sandbox` through explicit environment override when a provider requires it

Recommended Docker runtime settings for local validation:

- keep the browser sandbox enabled
- keep `infra/docker-compose/browser-audit-seccomp.json` attached to the
  service; it preserves Moby's default syscall policy while allowing the three
  namespace operations required by Chromium
- run as the image's non-root `bun` user with non-executable writable `/tmp`
  and home tmpfs mounts, plus at least 1 GiB of `/dev/shm`
- preserve `no-new-privileges` and ensure the host permits unprivileged user
  namespaces for the container runtime
- do not grant `SYS_ADMIN`; if a host policy blocks the bundled sandbox, fix
  user-namespace support instead
- only as a documented last resort, opt into
  `BROWSER_AUDIT_ALLOW_NO_SANDBOX=true` and treat that host as degraded
