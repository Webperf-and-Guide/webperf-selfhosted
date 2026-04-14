# Local Compose Quickstart

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

## What You Get

- `console`: SvelteKit UI
- `api`: Bun-based API service with SQLite persistence
- `scheduler`: Bun polling worker for scheduled dispatch
- `probe`: Rust measurement runtime

## Useful Env Vars

- `CONTROL_BASE_URL`: where the console proxies API requests
- `PROBE_SHARED_SECRET`: shared secret used between the API and probe
- `SELFHOST_ACTIVE_REGION_CODES_JSON`: active region list
- `SELFHOST_PROBE_BASE_URLS_JSON`: region to probe URL map
- `SELFHOST_DATABASE_PATH`: SQLite file path inside the API container
- `SELFHOST_SCHEDULER_API_BASE_URL`: base URL the scheduler polls
- `SELFHOST_SCHEDULER_POLL_INTERVAL_SECONDS`: scheduler polling interval

## Scheduling

The default local stack now includes `apps/scheduler`, which polls the API every
60 seconds and dispatches due saved checks.

If you prefer an external trigger instead, you can still call:

```sh
curl -X POST http://127.0.0.1:8788/v1/scheduler/dispatch
```

An example GitHub Actions workflow lives in [examples/github-actions/scheduler-dispatch.yml](../../examples/github-actions/scheduler-dispatch.yml).
