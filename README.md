# webperf-selfhosted

Self-hosted open-core WebPerf for release verification, scheduled checks, and baseline diffing across representative regions.

License: [Apache-2.0](LICENSE)

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

Provider-specific deployment walkthroughs can live on the managed product site when they are useful,
but the install and runtime docs in this repo should stay vendor-neutral.

## What It Does

- runs network-probe checks across representative cities instead of relying on a single URL or a single region
- stores saved sites, route groups, region sets, checks, runs, baselines, comparisons, and exports in SQLite
- includes a self-host console, API, scheduler, Rust probe runtime, and an optional Bun browser-audit worker
- focuses on release verification questions like "did this deploy get worse?" rather than general-purpose observability

## Quick Start

Single-machine local development:

```bash
bun install
bun run dev
```

Default local URLs:

- console: `http://localhost:5173`
- api: `http://127.0.0.1:8788`
- probe: `http://127.0.0.1:8080`
- browser-audit worker when run separately: `http://127.0.0.1:8081`

If you want the optional browser-audit direct-run surface too:

```bash
BROWSER_AUDIT_SHARED_SECRET=dev-browser-audit-shared-secret \
SELFHOST_BROWSER_AUDIT_BASE_URL=http://127.0.0.1:8081 \
bun run dev:api
```

Then run the worker in a second shell:

```bash
BROWSER_AUDIT_SHARED_SECRET=dev-browser-audit-shared-secret \
bun run dev:browser-audit-worker
```

The API then exposes:

- `GET /v1/browser-audits`
- `POST /v1/browser-audits`
- `GET /v1/browser-audits/:id`

Compose-based setup lives in [docs/quickstart/local-compose.md](docs/quickstart/local-compose.md).

## Useful Commands

```bash
bun run check
bun run dev:browser-audit-worker
bun run dev:parallel:cloud
bun run smoke:console
bun run --cwd apps/api check
bun test apps/api/test
bun run test:report-core
bun run compose:config
```

## Parallel Local Dev

If you want to run `webperf-selfhosted` alongside the managed cloud repo on the same machine, use:

```bash
bun run dev:parallel:cloud
bun run smoke:console:parallel:cloud
```

That keeps the default standalone ports unchanged while moving the selfhosted parallel workflow to:

- console: `http://localhost:4174`
- probe: `http://127.0.0.1:8082`

The helper scripts also support explicit overrides through:

- `SELFHOST_CONSOLE_PORT`
- `SELFHOST_CONTROL_BASE_URL`
- `SELFHOST_PROBE_PORT`
- `SELFHOST_PARALLEL_CONSOLE_PORT`
- `SELFHOST_PARALLEL_PROBE_PORT`
- `SELFHOST_PARALLEL_PROBE_BASE_URL`
- `SELFHOST_PARALLEL_PROBE_BASE_URLS_JSON`

The standalone smoke path still uses the default ports:

```bash
bun run smoke:console
```

## Optional Browser Audit Direct-Run

`apps/browser-audit-worker` remains an optional runtime, but the self-host API can now call it directly when you configure:

- `SELFHOST_BROWSER_AUDIT_BASE_URL`
- `BROWSER_AUDIT_SHARED_SECRET`
- `BROWSER_AUDIT_SHARED_SECRET_NEXT` for secret rotation

This direct-run surface is intentionally limited to persisted summaries and artifact metadata. It does not pull managed queue, fleet, provider, or tenancy logic into OSS.

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
Cloud local development continues to consume OSS packages through sibling `file:` dependencies, while runtime images continue to publish through GHCR.

## Public Launch Notes

Public launch notes live in:

- [docs/github-launch.md](docs/github-launch.md) for repo description, topics, and first-release polish
- [LICENSE](LICENSE) for the selected Apache-2.0 terms
