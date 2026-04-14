# control

Bun-based control service for the self-hosted stack.

## Current Scope

Implemented today:
- `GET /health`
- `GET /v1/regions`
- `GET /v1/jobs`
- `POST /v1/jobs`
- `GET /v1/jobs/:id`
- `GET /v1/jobs/:id/stream`
- saved configuration CRUD for properties, route sets, region packs, and check profiles
- baseline pinning and run comparison endpoints
- scheduled dispatch endpoint
- SQLite-backed persistence for runs and saved configuration
- custom request replay
- latency and uptime monitor policies
- generic webhook alert delivery
- JSON and CSV report export

Current limitations:
- no built-in background scheduler yet
- no tenancy or billing concerns

## Local Run

```sh
bun run dev:control
```

Default address:

```text
http://127.0.0.1:8788
```

## Environment

Copy values from:

```text
apps/control/.env.example
```

Useful defaults:
- `SELFHOST_DATABASE_PATH=./data/control.sqlite`
- `SELFHOST_RETENTION_DAYS=30`
- `SELFHOST_ACTIVE_REGION_CODES_JSON=["tokyo"]`
- `SELFHOST_PROBE_BASE_URLS_JSON={"tokyo":"http://127.0.0.1:8080"}`
- `PROBE_SHARED_SECRET=dev-shared-secret`

## Compose

The Compose bundle lives at:

```text
infra/compose/docker-compose.yml
```
