# Docker Compose Install

Use this path when you want the default stack in Docker rather than local process mode.

## Quick Start

1. Copy the Compose env example:

```sh
cp infra/docker-compose/.env.example infra/docker-compose/.env
```

2. Start the stack:

```sh
docker compose --env-file infra/docker-compose/.env -f infra/docker-compose/docker-compose.yml up --build
```

3. Open the console:

```sh
open http://localhost:5173
```

4. Verify API health:

```sh
curl http://127.0.0.1:8788/health
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
- `browser-audit-worker`: optional Bun browser-audit runtime when you enable the `browser-audit` profile

## Useful Env Vars

- `CONTROL_BASE_URL`: where the console proxies API requests
- `PROBE_SHARED_SECRET`: shared secret used between the API and probe; replace the example value before you boot the stack
- `BROWSER_AUDIT_SHARED_SECRET`: shared secret used for signed browser-audit requests when the optional worker is enabled
- `BROWSER_AUDIT_SHARED_SECRET_NEXT`: optional rollover secret accepted alongside the current browser-audit key
- `BROWSER_AUDIT_ALLOW_NO_SANDBOX`: explicit opt-in for local runtimes that cannot keep Chrome sandboxing enabled
- `SELFHOST_ACTIVE_REGION_CODES_JSON`: active region list
- `SELFHOST_PROBE_BASE_URLS_JSON`: region to probe URL map
- `SELFHOST_DATABASE_PATH`: SQLite file path inside the API container
- `SELFHOST_SCHEDULER_API_BASE_URL`: base URL the scheduler polls
- `SELFHOST_SCHEDULER_POLL_INTERVAL_SECONDS`: scheduler polling interval

The probe is intentionally not published on a host port by default.
If you need direct host access for debugging, add a temporary port mapping in your local Compose override instead of exposing it permanently.

## Compose Smoke Helpers

The repo now includes explicit Compose smoke wrappers:

```sh
bun run smoke:compose
bun run smoke:compose:browser-audit
```

- `smoke:compose` verifies the default Compose stack plus the browser-console flow.
- `smoke:compose:browser-audit` enables the `browser-audit` profile, wires the API to the worker over the internal Compose network, and verifies a direct-run browser audit end-to-end.

## Optional Browser Audit Worker

The browser-audit worker is intentionally not part of the default stack.

Enable it only when you want to run the optional Bun + Chrome + Puppeteer + Lighthouse runtime:

```sh
docker compose \
  --env-file infra/docker-compose/.env \
  --profile browser-audit \
  -f infra/docker-compose/docker-compose.yml \
  up --build
```

When enabled, it is published on `http://127.0.0.1:${BROWSER_AUDIT_PUBLIC_PORT:-8081}`.
When `SELFHOST_BROWSER_AUDIT_BASE_URL` and `BROWSER_AUDIT_SHARED_SECRET` are configured in the API container, the self-host API can call it directly through `POST /v1/browser-audits`.
The Compose profile adds `SYS_ADMIN` so Chrome can keep its sandbox enabled during local Docker runs.

Example direct-run request once the worker profile is up:

```sh
curl -X POST http://127.0.0.1:8788/v1/browser-audits \
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

If you prefer an external trigger instead, you can still call:

```sh
curl -X POST http://127.0.0.1:8788/v1/scheduler/dispatch
```

An example GitHub Actions workflow lives in [examples/github-actions/scheduler-dispatch.yml](../../examples/github-actions/scheduler-dispatch.yml).

## Related Docs

- [single-machine quickstart](/Users/imjlk/repos/and-guide/webperf-selfhosted/docs/quickstart/single-machine.md)
- [parallel local dev](/Users/imjlk/repos/and-guide/webperf-selfhosted/docs/quickstart/parallel-local-dev.md)
- [browser-audit worker](/Users/imjlk/repos/and-guide/webperf-selfhosted/docs/self-hosting/browser-audit-worker.md)
