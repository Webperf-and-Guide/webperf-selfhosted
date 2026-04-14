# Compose Bundle

This folder contains the local Compose bundle for the self-hosted stack.

## What It Runs

- `console`: SvelteKit console built with the Node adapter
- `probe`: the Rust probe runtime
- `api`: the Bun-based API service with SQLite persistence
- `scheduler`: the Bun polling worker for scheduled checks
- `browser-audit-worker`: optional Bun browser-audit runtime behind the `browser-audit` profile

## Start With Docker Compose

```sh
docker compose -f infra/docker-compose/docker-compose.yml up --build
```

To customize ports, secrets, or active regions:

```sh
cp infra/docker-compose/.env.example infra/docker-compose/.env
docker compose --env-file infra/docker-compose/.env -f infra/docker-compose/docker-compose.yml up --build
```

The probe stays on the internal Compose network by default.
Only the console and API are published to the host unless you add an explicit probe port mapping.
The browser-audit worker is excluded by default and only starts when you enable the `browser-audit` profile.

Console:

```sh
open http://localhost:5173
```

API health:

```sh
curl http://127.0.0.1:8788/health
```

## Optional Browser Audit Runtime

To start the optional worker:

```sh
docker compose \
  --env-file infra/docker-compose/.env \
  --profile browser-audit \
  -f infra/docker-compose/docker-compose.yml \
  up --build
```

This publishes the worker on `http://127.0.0.1:${BROWSER_AUDIT_PUBLIC_PORT:-8081}`.
The Compose profile adds `SYS_ADMIN` so Chrome can keep its sandbox enabled during local Docker runs.

## Persistence

The API service stores job history in SQLite at `/data/webperf.sqlite` inside the container.
The named volume `webperf-data` keeps that file across restarts.

## Worker Environment

- `BROWSER_AUDIT_SHARED_SECRET`: current signing key for `POST /audit`
- `BROWSER_AUDIT_SHARED_SECRET_NEXT`: optional rollover key
- `BROWSER_AUDIT_ALLOW_NO_SANDBOX`: explicit opt-in for degraded local runtimes
- `BROWSER_AUDIT_PUBLIC_PORT`: host port exposed when the optional profile is enabled

See [docs/quickstart/local-compose.md](../../docs/quickstart/local-compose.md) for the current install path and scheduling notes.
