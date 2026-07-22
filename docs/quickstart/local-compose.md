# Docker Compose Install

Use this source-checkout path when validating the default stack in Docker.
Operators should prefer the digest-pinned [release install](../users/install.md),
which does not require Bun or a repository checkout.

## Quick Start

1. Generate a Compose env file with random secrets:

```sh
bun run selfhost:init
```

2. Confirm the versioned image tag in `infra/docker-compose/.env`, then start
   the stack:

```sh
docker compose \
  --env-file infra/docker-compose/.env \
  -f infra/docker-compose/compose.yml \
  up -d
```

3. Open the console:

```sh
open http://localhost:5173
```

4. Verify the console's authenticated server-side API path:

```sh
curl http://127.0.0.1:5173/api/control/health
```

5. Smoke the console path:

```sh
bun run smoke:console
```

6. Optional: capture route baselines from the running Compose console:

```sh
bun run capture:console:baselines
```

## What You Get

- `console`: SvelteKit UI
- `api`: Bun-based API service with SQLite persistence
- `scheduler`: Bun polling worker for scheduled dispatch
- `probe`: Rust measurement runtime on the internal Compose network
- `browser-audit-lighthouse`: optional Bun browser-audit runtime when you enable the `browser-audit` profile

`compose.yml` consumes versioned GHCR images. Repository contributors can add
`-f infra/docker-compose/compose.dev.yml --build` to build the same services
from the current checkout.

## Useful Env Vars

- `CONTROL_BASE_URL`: where the console proxies API requests
- `SELFHOST_ADMIN_TOKEN`: server-only console and operator API token
- `SELFHOST_INTERNAL_SECRET`: scheduler/executor credential and encrypted-payload key source
- `PROBE_SHARED_SECRET`: shared secret used between the executor and probe; replace the example value before you boot the stack
- `BROWSER_AUDIT_SHARED_SECRET`: shared secret used for signed browser-audit requests when the optional worker is enabled
- `BROWSER_AUDIT_SHARED_SECRET_NEXT`: optional rollover secret accepted alongside the current browser-audit key
- `BROWSER_AUDIT_ALLOW_NO_SANDBOX`: explicit opt-in for local runtimes that cannot keep Chrome sandboxing enabled
- `SELFHOST_ACTIVE_REGION_CODES_JSON`: active region list
- `SELFHOST_PROBE_BASE_URLS_JSON`: region to probe URL map
- `SELFHOST_DATABASE_PATH`: SQLite file path inside the API container
- `SELFHOST_ARTIFACTS_PATH`: Browser Audit artifact root inside the API container
- `SELFHOST_ARTIFACT_UPLOAD_BASE_URL`: internal API origin reachable by the runner
- `SELFHOST_MAX_ARTIFACT_BYTES`: per-file upload limit
- `SELFHOST_ARTIFACT_UPLOAD_TTL_SECONDS`: lifetime of scoped runner upload grants
- `SELFHOST_MIGRATION_BACKUP`: set to `true` to create a verified snapshot before
  startup applies pending migrations to an existing database
- `SELFHOST_SCHEDULER_API_BASE_URL`: base URL the scheduler polls
- `SELFHOST_SCHEDULER_POLL_INTERVAL_SECONDS`: scheduler polling interval

Only the console is published, and it binds to `127.0.0.1`. The API, probe,
scheduler, executor, and optional Browser Audit runner have no host ports. Use
the loopback-only `debug` profile when direct API or runner access is necessary;
do not add a permanent public mapping.

See [SQLite operations](../self-hosting/database-operations.md) before an
upgrade or restore. It includes commands that operate directly on the Compose
named volume without exposing SQLite over the network.
Artifact backup and retention behavior is documented in
[Browser Audit artifact storage](../self-hosting/artifacts.md).

## Compose Smoke Helpers

The repo now includes explicit Compose smoke wrappers:

```sh
bun run smoke:compose
bun run smoke:compose:browser-audit
```

- `smoke:compose` verifies the default Compose stack plus the browser-console flow.
- `smoke:compose:browser-audit` enables the `browser-audit` profile, wires the executor to the worker over the internal Compose network, and verifies a queued Browser Audit end-to-end.

## Optional Browser Audit Worker

The browser-audit Lighthouse runner is intentionally not part of the default stack.

Enable it only when you want to run the optional Bun + Chrome + Puppeteer + Lighthouse runtime:

```sh
docker compose \
  --env-file infra/docker-compose/.env \
  --profile browser-audit \
  -f infra/docker-compose/compose.yml \
  up -d
```

Before starting it, set
`SELFHOST_BROWSER_AUDIT_BASE_URL=http://browser-audit-lighthouse:8080` in the
env file. The runner remains internal when enabled.
When `SELFHOST_BROWSER_AUDIT_BASE_URL` and `BROWSER_AUDIT_SHARED_SECRET` are configured, `POST /v1/browser-audits` queues work for the executor, which calls the optional runner and persists the result.
Artifacts are written to `/data/artifacts` in the private data volume and are
downloaded through the authenticated API/console. The size and upload lifetime
can be tuned with `SELFHOST_MAX_ARTIFACT_BYTES` and
`SELFHOST_ARTIFACT_UPLOAD_TTL_SECONDS`.
The image configures Chrome's setuid sandbox and the profile does not grant
`SYS_ADMIN`. One runner accepts at most one in-flight audit.

For direct API debugging only, start the loopback proxy and then send an
administrator-authenticated request:

```sh
docker compose \
  --env-file infra/docker-compose/.env \
  --profile debug \
  -f infra/docker-compose/compose.yml \
  up -d api-debug

curl -X POST http://127.0.0.1:8788/v1/browser-audits \
  -H "authorization: Bearer $SELFHOST_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "targetUrl": "https://example.com",
    "policy": {
      "preset": "mobile",
      "flow": {
        "steps": [{ "type": "navigate", "url": "https://example.com" }]
      }
    }
  }'
```

## Scheduling

The default local stack now includes `apps/scheduler`, which polls the API every
60 seconds and dispatches due saved checks.

If you need to inspect the dispatch endpoint, use the loopback debug proxy and
the internal service credential:

```sh
curl -X POST http://127.0.0.1:8788/v1/scheduler/dispatch \
  -H "authorization: Bearer $SELFHOST_INTERNAL_SECRET"
```

An example GitHub Actions workflow lives in [examples/github-actions/scheduler-dispatch.yml](../../examples/github-actions/scheduler-dispatch.yml).

## Related Docs

- [single-machine quickstart](./single-machine.md)
- [parallel local dev](./parallel-local-dev.md)
- [browser-audit Lighthouse runner](../self-hosting/browser-audit-lighthouse.md)
