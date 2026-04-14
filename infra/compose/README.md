# Compose Bundle

This folder contains the local Compose bundle for the self-hosted stack.

## What It Runs

- `console`: SvelteKit console built with the Node adapter
- `probe`: the Rust probe runtime
- `control`: the Bun-based control service with SQLite persistence

## Start With Docker Compose

```sh
docker compose -f infra/compose/docker-compose.yml up --build
```

To customize ports, secrets, or active regions:

```sh
cp infra/compose/.env.example infra/compose/.env
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml up --build
```

Console:

```sh
open http://localhost:5173
```

Control health:

```sh
curl http://127.0.0.1:8788/health
```

## Persistence

The control service stores job history in SQLite at `/data/control.sqlite` inside the container.
The named volume `control-data` keeps that file across restarts.

See [docs/install.md](../../docs/install.md) for the current install path and scheduling notes.
