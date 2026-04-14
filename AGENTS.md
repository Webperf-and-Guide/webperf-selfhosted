# AGENTS.md

Living execution brief for `webperf-selfhosted`.

Last updated: 2026-04-14

## Mission

Build a self-hosted product for:
- global release verification
- SEO-aware performance verification
- deploy-time regression detection across representative cities

This repo should optimize for:
- "did this deploy get worse?" over "what is the average right now?"
- representative route sets over one-off URLs
- a real self-hosted workflow, not a viewer-only demo

## Product Boundary

Brand:
- product name: `WebPerf`
- managed cloud domain/product: `webperf.and.guide`
- public OSS repo: `webperf-selfhosted`

Role split:
- `webperf-selfhosted` is the self-hosted/open-core product
- `webperf.and.guide` is the managed cloud product and business layer

This repo is the source of truth for:
- self-host console/api/scheduler/probe behavior
- public contracts and schemas
- public domain models
- deterministic reporting and comparison logic
- self-host deployment docs and examples

This repo must not absorb:
- billing, quotas, or usage metering
- multi-tenant auth/workspace logic
- managed cloud orchestration or hosted runner fleet logic
- private provider credentials or internal ops tooling
- AI analyst product features

Boundary rule:
- if a self-host operator can use the feature independently, it belongs here
- if it only becomes valuable through managed hosting, automation, billing, or SaaS collaboration, it belongs in `webperf.and.guide`

## Repo Shape

Included here:
- `apps/console`
- `apps/api`
- `apps/scheduler`
- `apps/probe-rs`
- `packages/contracts`
- `packages/domain-core`
- `packages/config`
- `packages/report-core`
- `packages/ui`
- `infra/docker-compose`
- `infra/docker`
- `docs`

## Snapshot

Current repo state as of 2026-04-14:
- the console, API service, scheduler, and Rust probe run together locally
- the API service persists saved config, runs, baselines, comparisons, and reports in SQLite
- local compose packaging lives under `infra/docker-compose`
- shared packages are versioned as `@webperf/*`
- release metadata tooling uses Sampo via `.sampo/`
- `packages/contracts` now exports split `public`, `app`, and `ops` oRPC contracts alongside the legacy compatibility `control` contract
- `packages/contracts` now builds a public OpenAPI skeleton from the resource-oriented `public` contract
- `apps/api` now serves `/rpc/public`, `/rpc/app`, `/rpc/ops`, and legacy `/rpc`, plus `/openapi/public.json` and `/openapi/control.json`
- `apps/api` now exposes public REST aliases for `sites`, `routeGroups`, `regionSets`, `checks`, `runs`, and `capabilities` while keeping the older `/v1/properties`, `/v1/route-sets`, `/v1/region-packs`, and `/v1/check-profiles` endpoints for compatibility
- `apps/api` now exposes first-class public `comparisons`, `exports`, and `analyses` resources backed by persisted derived payloads
- `apps/console` now proxies through merged split `app` and `ops` oRPC clients directly, replacing the hand-written control-plane façade while keeping SSE reconstruction and typed report export handling
- console runtime config now centers on `CONTROL_BASE_URL` for self-hosted access instead of the older binding-oriented env surface
- the console now leans into an operator-facing self-host workflow: manual run first, reusable checks second, region catalog third, with product copy using site/route group/region set/check terminology instead of implementation-heavy labels
- docs now explicitly treat this repo as the public source of truth for self-hosted contracts, schemas, and deterministic reporting behavior

Current local dev entrypoints:
- `bun run dev`
- `bun run dev:console`
- `bun run dev:api`
- `bun run dev:scheduler`
- `bun run dev:probe`

Current local URLs:
- console: `http://localhost:5173`
- api: `http://127.0.0.1:8788`
- probe: `http://127.0.0.1:8080`

## Working Rules

- keep the repo self-host coherent
- avoid adding managed runtime assumptions into public packages
- prefer extracting reusable logic into `packages/domain-core` or `packages/report-core`
- keep setup simple enough for a small single-org deployment
- keep public packages as the source of truth that cloud code consumes rather than forks
- keep browser-audit extension points vendor-neutral and optional
- keep AI-specific product logic out of the OSS core

## Immediate Next Tasks

1. verify `bun run dev` end-to-end in the renamed layout
2. decide how far the public HTTP aliases should go beyond the current `sites/routeGroups/regionSets/checks/runs/comparisons/exports/analyses` surface
3. keep refining install docs and compose ergonomics
4. decide how package publishing should work once the repo is public
5. decide whether public comparison/export resources should get richer server-side pagination and filtering
6. keep tightening the console around operator workflows and reduce any remaining marketing-style presentation drift

## Update Protocol

When making meaningful progress, update this file in the same change.
