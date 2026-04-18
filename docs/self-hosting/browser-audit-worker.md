# Browser Audit Worker

`apps/browser-audit-worker` is an optional self-host runtime.

It is the OSS source of truth for the Bun-first browser-audit container used by both:

- self-host operators who want to run the worker directly
- the managed cloud product, which consumes the published image and adds orchestration around it

What it does not include:

- queueing or persistence
- managed artifact retention
- Bunny or Cloudflare fleet control

## Runtime Profile

Current tested quartet:

- Bun: `1.3.11`
- amd64 browser: `Google Chrome 147.0.7727.56 (Chrome for Testing)`
- arm64 browser: `Chromium 147.0.7727.55 (Debian package)`
- Puppeteer: `24.40.0`
- Lighthouse: `13.1.0`

The worker exposes the active runtime versions through `GET /capabilities`.

## Local Run

```bash
bun run dev:browser-audit-worker
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

## Self-Hosted API Direct-Run

The worker stays optional, but the self-host API can now use it directly when both of these are configured on the API side:

- `SELFHOST_BROWSER_AUDIT_BASE_URL`
- `BROWSER_AUDIT_SHARED_SECRET`

That enables the public self-host resources:

- `GET /v1/browser-audits`
- `POST /v1/browser-audits`
- `GET /v1/browser-audits/:id`

The API persists:

- execution status
- summary metrics
- failure reason
- artifact metadata and pointers

It intentionally does not add:

- binary artifact download endpoints
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
  -f infra/docker-compose/docker-compose.yml \
  up --build
```

The profile publishes the worker on `http://127.0.0.1:${BROWSER_AUDIT_PUBLIC_PORT:-8081}`.
The bundled Compose profile adds `SYS_ADMIN` so Chrome can keep its sandbox enabled locally.

## Docker Build

Build from the `webperf-selfhosted` repo root:

```bash
docker build \
  -f apps/browser-audit-worker/Dockerfile \
  -t webperf-browser-audit-worker:dev \
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

## Runtime Notes

Recommended container behavior:

- one in-flight audit per worker
- fresh browser/page per audit
- worker process stays warm for sequential audits
- no `--no-sandbox` by default
- only allow `--no-sandbox` through explicit environment override when a provider requires it

Recommended Docker runtime settings for local validation:

- keep the browser sandbox enabled
- add `--cap-add=SYS_ADMIN` when running the container locally on Docker Desktop or OrbStack
- if a provider cannot supply the required sandbox support, opt into `BROWSER_AUDIT_ALLOW_NO_SANDBOX=true` explicitly and treat that as a degraded profile
