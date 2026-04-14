# Compose Bundle

This folder contains the local Compose bundle for the self-hosted stack.

## What It Runs

- `console`: SvelteKit console built with the Node adapter
- `probe`: the Rust probe runtime
- `api`: the Bun-based API service with SQLite persistence
- `scheduler`: the Bun polling worker for scheduled checks

## Start With Docker Compose

```sh
docker compose -f infra/docker-compose/docker-compose.yml up --build
```

To customize ports, secrets, or active regions:

```sh
cp infra/docker-compose/.env.example infra/docker-compose/.env
docker compose --env-file infra/docker-compose/.env -f infra/docker-compose/docker-compose.yml up --build
```

Console:

```sh
open http://localhost:5173
```

API health:

```sh
curl http://127.0.0.1:8788/health
```

## Persistence

The API service stores job history in SQLite at `/data/webperf.sqlite` inside the container.
The named volume `webperf-data` keeps that file across restarts.

See [docs/quickstart/local-compose.md](../../docs/quickstart/local-compose.md) for the current install path and scheduling notes.
