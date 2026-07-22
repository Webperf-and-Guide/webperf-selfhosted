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
- `apps/browser-audit-lighthouse`: optional Lighthouse reference implementation of the public Browser Audit Protocol
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
- [self-host authentication and secrets](docs/security/auth-and-secrets.md)
- [SQLite backup, restore, and maintenance](docs/self-hosting/database-operations.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [CHANGELOG.md](CHANGELOG.md)

Provider-specific deployment walkthroughs can live on the managed product site when they are useful,
but the install and runtime docs in this repo should stay vendor-neutral.

## What It Does

- runs network-probe checks across representative cities instead of relying on a single URL or a single region
- stores saved sites, route groups, region sets, checks, runs, baselines, comparisons, and exports in SQLite
- includes a self-host console, API, scheduler, Rust probe runtime, and an optional Lighthouse Browser Audit reference runner
- focuses on release verification questions like "did this deploy get worse?" rather than general-purpose observability

## Quick Start

Fastest local path:

```bash
bun install
bun run dev
```

Default local URLs:

- console: `http://localhost:5173`
- api: `http://127.0.0.1:8788`
- probe: `http://127.0.0.1:8080`
- Lighthouse Browser Audit runner when run separately: `http://127.0.0.1:8081`

Launch-ready docs are grouped into five operator paths:

- [single-machine quickstart](/Users/imjlk/repos/and-guide/webperf-selfhosted/docs/quickstart/single-machine.md)
- [docker compose install](/Users/imjlk/repos/and-guide/webperf-selfhosted/docs/quickstart/local-compose.md)
- [optional Lighthouse Browser Audit runner](/Users/imjlk/repos/and-guide/webperf-selfhosted/docs/self-hosting/browser-audit-lighthouse.md)
- [parallel local dev](/Users/imjlk/repos/and-guide/webperf-selfhosted/docs/quickstart/parallel-local-dev.md)
- [GHCR runtime images](/Users/imjlk/repos/and-guide/webperf-selfhosted/docs/quickstart/runtime-images.md)

Provider-specific deployment walkthroughs belong on `webperf.and.guide`, not in this repo.

## Useful Commands

```bash
bun run check
bun run selfhost:init
bun run selfhost:migrate
bun run selfhost:backup
bun run selfhost:doctor
bun run selfhost:maintenance
bun run dev:browser-audit-lighthouse
bun run dev:parallel
bun run smoke:console
bun run smoke:compose
bun run smoke:compose:browser-audit
bun run capture:console:baselines
bun run --cwd apps/api check
bun test apps/api/test
bun run test:report-core
bun run compose:config
```

## Public API

The current v1 resource-oriented surface is intentionally stabilized around:

- `sites`
- `routeGroups`
- `regionSets`
- `checks`
- `runs`
- `comparisons`
- `exports`
- `analyses`
- `browserAudits`
- `capabilities`

`runs` stay intentionally split between:

- nested run lists at `GET /v1/checks/:checkId/runs`
- persisted run detail at `GET /v1/runs/:runId`

Compatibility aliases remain available for:

- `/v1/properties`
- `/v1/route-sets`
- `/v1/region-packs`
- `/v1/check-profiles`

Compatibility responses are marked deprecated and link to their canonical
successor. They are migration-only surfaces that may be removed at public v1.0;
new integrations should use the canonical paths above.

See [public-api-surface.md](/Users/imjlk/repos/and-guide/webperf-selfhosted/docs/architecture/public-api-surface.md) for the current freeze line and list-query contract.

## Parallel Local Dev

Use [parallel-local-dev.md](/Users/imjlk/repos/and-guide/webperf-selfhosted/docs/quickstart/parallel-local-dev.md) when the default development ports are already occupied or two self-host configurations need to run side-by-side.

## Optional Browser Audit

`apps/browser-audit-lighthouse` is the optional Lighthouse reference runner for the engine-neutral Browser Audit Protocol. The API queues audits and `apps/executor` calls the runner when you configure:

- `SELFHOST_BROWSER_AUDIT_BASE_URL`
- `BROWSER_AUDIT_SHARED_SECRET`
- `BROWSER_AUDIT_SHARED_SECRET_NEXT` for secret rotation

The API returns a queued resource immediately; poll `GET /v1/browser-audits/:id` for completion. This surface is intentionally limited to persisted summaries and artifact metadata. It does not pull managed fleet, provider, or tenancy logic into OSS.

## Compose Bundle

Compose assets live in [infra/docker-compose/docker-compose.yml](infra/docker-compose/docker-compose.yml).

Install and scheduling notes live in:

- [docs/quickstart/local-compose.md](docs/quickstart/local-compose.md)
- [docs/architecture/execution-model.md](docs/architecture/execution-model.md)
- [docs/self-hosting/browser-audit-lighthouse.md](docs/self-hosting/browser-audit-lighthouse.md)
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

See [runtime-images.md](/Users/imjlk/repos/and-guide/webperf-selfhosted/docs/quickstart/runtime-images.md) for the current GHCR image policy and checked-in metadata refs.

Cloud local development continues to consume OSS packages through sibling `file:` dependencies, while runtime images continue to publish through GHCR.
Merges or direct pushes to `main` automatically publish the probe and browser-audit images through the checked-in GitHub Actions workflows.

## Public Launch Notes

Public launch notes live in:

- [docs/github-launch.md](docs/github-launch.md) for repo description, topics, and first-release polish
- [LICENSE](LICENSE) for the selected Apache-2.0 terms
