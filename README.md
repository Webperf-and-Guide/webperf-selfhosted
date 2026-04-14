# webperf-selfhosted

Self-hosted open-core WebPerf for global release verification, scheduled checks, and baseline diffing.

WebPerf has two distinct product surfaces:

- `webperf-selfhosted`: the self-hosted OSS/open-core product
- `webperf.and.guide`: the managed cloud product and business layer

This repository is the self-hosted source of truth for:

- `apps/console`: SvelteKit UI for configuring checks and reviewing runs
- `apps/api`: Bun + SQLite API service for saved config, run dispatch, history, comparisons, and reports
- `apps/scheduler`: polling worker for scheduled check dispatch
- `apps/probe-rs`: Rust probe runtime
- `apps/browser-audit-worker`: optional Bun-first browser audit runtime
- `packages/contracts`, `packages/domain-core`, `packages/config`, `packages/report-core`, `packages/ui`
- `infra/docker-compose`: Docker Compose bundle
- `infra/docker`: runtime image metadata

This repository is intentionally not the home for:

- billing, pricing, usage metering, or quotas
- tenant/workspace auth and seat management
- cloud-only orchestration, managed runner scaling, or private admin surfaces
- hosted artifact retention and internal ops automation
- AI analyst product features beyond structured deterministic outputs

See:

- [docs/self-hosting/feature-scope.md](docs/self-hosting/feature-scope.md)
- [docs/comparison/cloud-vs-selfhosted.md](docs/comparison/cloud-vs-selfhosted.md)

## Local Development

```bash
bun install
bun run dev
```

Default local URLs:

- console: `http://localhost:5173`
- api: `http://127.0.0.1:8788`
- probe: `http://127.0.0.1:8080`
- browser-audit worker when run separately: `http://127.0.0.1:8081`

## Useful Commands

```bash
bun run check
bun run dev:browser-audit-worker
bun test apps/api/test
bun run test:report-core
bun run compose:config
```

## Compose Bundle

Compose assets live in [infra/docker-compose/docker-compose.yml](infra/docker-compose/docker-compose.yml).

Install and scheduling notes live in:

- [docs/quickstart/local-compose.md](docs/quickstart/local-compose.md)
- [docs/architecture/execution-model.md](docs/architecture/execution-model.md)
- [docs/self-hosting/browser-audit-worker.md](docs/self-hosting/browser-audit-worker.md)
- [examples/github-actions/scheduler-dispatch.yml](examples/github-actions/scheduler-dispatch.yml)

## Release Tooling

This repo uses Sampo for release metadata.

```bash
bun run sampo:add
bun run sampo:release:dry-run
bun run sampo:release
bun run sampo:publish
```

Pending release notes live under `.sampo/changesets/`.
