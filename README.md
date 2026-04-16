# webperf-selfhosted

Self-hosted open-core WebPerf for release verification, scheduled checks, and baseline diffing across representative regions.

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
- `infra/docker`: runtime image metadata consumed by the managed cloud repo

This repository is intentionally not the home for:

- billing, pricing, usage metering, or quotas
- tenant/workspace auth and seat management
- cloud-only orchestration, managed runner scaling, or private admin surfaces
- hosted artifact retention and internal ops automation
- AI analyst product features beyond structured deterministic outputs

See:

- [docs/self-hosting/feature-scope.md](docs/self-hosting/feature-scope.md)
- [docs/comparison/cloud-vs-selfhosted.md](docs/comparison/cloud-vs-selfhosted.md)
- [docs/github-launch.md](docs/github-launch.md)
- [SECURITY.md](SECURITY.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [CHANGELOG.md](CHANGELOG.md)

## What It Does

- runs network-probe checks across representative cities instead of relying on a single URL or a single region
- stores saved sites, route groups, region sets, checks, runs, baselines, comparisons, and exports in SQLite
- includes a self-host console, API, scheduler, Rust probe runtime, and an optional Bun browser-audit worker
- focuses on release verification questions like "did this deploy get worse?" rather than general-purpose observability

## Quick Start

Local development:

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

## Published Images

The reusable runtime images in this repo are intended to publish as:

- `ghcr.io/webperf-and-guide/webperf-probe`
- `ghcr.io/webperf-and-guide/webperf-browser-audit-worker`

Checked-in image refs live under:

- [infra/docker/metadata/probe.json](infra/docker/metadata/probe.json)
- [infra/docker/metadata/browser-audit-worker.json](infra/docker/metadata/browser-audit-worker.json)

Those metadata files are consumed by the managed cloud repo when it renders Cloudflare/Bunny runtime config.

## Public Launch Notes

Before connecting the public GitHub repo, review:

- [docs/github-launch.md](docs/github-launch.md) for repo description, topics, and first-release polish
- `LICENSE` selection guidance in the same document
