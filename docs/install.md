# Install

## Quick Start

1. Copy the Compose env example:

```sh
cp infra/compose/.env.example infra/compose/.env
```

2. Start the stack:

```sh
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml up --build
```

3. Open the console:

```sh
open http://localhost:5173
```

4. Verify control health:

```sh
curl http://127.0.0.1:8788/health
```

## What You Get

- `console`: SvelteKit UI
- `control`: Bun-based control service with SQLite persistence
- `probe`: Rust measurement runtime

## Useful Env Vars

- `CONTROL_BASE_URL`: where the console proxies control requests
- `PROBE_SHARED_SECRET`: shared secret used between control and probe
- `SELFHOST_ACTIVE_REGION_CODES_JSON`: active region list
- `SELFHOST_PROBE_BASE_URLS_JSON`: region to probe URL map
- `SELFHOST_DATABASE_PATH`: SQLite file path inside the control container

## Scheduling

Scheduling is currently external-cron driven.
Use a cron job, systemd timer, GitHub Actions schedule, or another scheduler to call:

```sh
curl -X POST http://127.0.0.1:8788/v1/scheduler/dispatch
```

An example GitHub Actions workflow lives in [docs/examples/github-actions-scheduler.yml](examples/github-actions-scheduler.yml).
