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

## Repo Shape

Included here:
- `apps/console`
- `apps/control`
- `apps/probe-rs`
- `packages/contracts`
- `packages/domain-core`
- `packages/env-schema`
- `packages/report-engine`
- `packages/ui`
- `infra/compose`
- `infra/docker`

## Snapshot

Current repo state as of 2026-04-13:
- the console, control service, and Rust probe run together locally
- the control service persists saved config, runs, baselines, comparisons, and reports in SQLite
- local compose packaging lives under `infra/compose`
- shared packages are versioned as `@webperf/*`
- release metadata tooling uses Sampo via `.sampo/`
- `packages/contracts` now exports split `public`, `app`, and `ops` oRPC contracts alongside the legacy compatibility `control` contract
- `packages/contracts` now builds a public OpenAPI skeleton from the resource-oriented `public` contract
- `apps/control` now serves `/rpc/public`, `/rpc/app`, `/rpc/ops`, and legacy `/rpc`, plus `/openapi/public.json` and `/openapi/control.json`
- `apps/control` now exposes public REST aliases for `sites`, `routeGroups`, `regionSets`, `checks`, `runs`, and `capabilities` while keeping the older `/v1/properties`, `/v1/route-sets`, `/v1/region-packs`, and `/v1/check-profiles` endpoints for compatibility
- `apps/control` now exposes first-class public `comparisons`, `exports`, and `analyses` resources backed by persisted derived payloads
- `apps/console` now proxies through merged split `app` and `ops` oRPC clients directly, replacing the hand-written control-plane façade while keeping SSE reconstruction and typed report export handling
- console runtime config now centers on `CONTROL_BASE_URL` for self-hosted access instead of the older binding-oriented env surface

Current local dev entrypoints:
- `bun run dev`
- `bun run dev:console`
- `bun run dev:control`
- `bun run dev:probe`

Current local URLs:
- console: `http://localhost:5173`
- control: `http://127.0.0.1:8788`
- probe: `http://127.0.0.1:8080`

## Working Rules

- keep the repo self-host coherent
- avoid adding managed runtime assumptions into public packages
- prefer extracting reusable logic into `packages/domain-core` or `packages/report-engine`
- keep setup simple enough for a small single-org deployment

## Immediate Next Tasks

1. verify `bun run dev` end-to-end in the renamed layout
2. decide how far the public HTTP aliases should go beyond the current `sites/routeGroups/regionSets/checks/runs/comparisons/exports/analyses` surface
3. keep refining install docs and compose ergonomics
4. decide how package publishing should work once the repo is public
5. decide whether public comparison/export resources should get richer server-side pagination and filtering

## Update Protocol

When making meaningful progress, update this file in the same change.
