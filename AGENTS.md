# AGENTS.md

Living execution brief for `webperf-selfhosted`.

Last updated: 2026-04-18

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
- `apps/browser-audit-worker`
- `packages/contracts`
- `packages/domain-core`
- `packages/config`
- `packages/report-core`
- `packages/ui`
- `infra/docker-compose`
- `infra/docker`
- `docs`

## Snapshot

Current repo state as of 2026-04-18:
- the console, API service, scheduler, and Rust probe run together locally
- the optional Bun browser-audit worker now also lives here as the runtime/image source of truth, while managed orchestration stays in `webperf.and.guide`
- the API service persists saved config, runs, baselines, comparisons, and reports in SQLite
- local compose packaging lives under `infra/docker-compose`
- the Rust probe Dockerfile now builds for the requested target platform instead of accidentally pinning builds to the host architecture; both native and `linux/amd64` images have been smoke-tested with `/healthz` and signed `/measure` requests
- Bun service images now run as the `bun` user, and the Compose bundle no longer publishes the internal probe port or falls back to a known shared secret
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
- `packages/ui` now acts as the shared token source of truth for both OSS and cloud UI surfaces, with Tailwind v4-compatible operator and marketing theme entrypoints plus a minimal shadcn-compatible primitive structure
- the console shell and overview now consume the shared token layer and section wrappers so the IA reads as `Run / Resources / Checks / Reports / Regions` instead of one mixed document
- `packages/ui` now also exposes a shadcn-compatible shared surface under `src/lib/components/ui/*`, with root-level `jsrepo.config.ts` routing `@ieedan/shadcn-svelte-extras` into the shared package instead of app-local copies
- docs now explicitly treat this repo as the public source of truth for self-hosted contracts, schemas, and deterministic reporting behavior
- `packages/contracts` now also defines browser-audit policy, flow DSL, result, artifact, toolchain, and worker request/response schemas as public-safe source-of-truth types
- `apps/browser-audit-worker` is optional: it is not part of the default `bun run dev` or default Compose stack, but it can be run directly or via the `browser-audit` Compose profile
- `infra/docker/metadata/probe.json` and `infra/docker/metadata/browser-audit-worker.json` are now the canonical checked-in image refs that the managed cloud repo consumes when it renders Cloudflare/Bunny runtime config
- probe request signing in `packages/domain-core` now uses stable key ordering so Bun/TypeScript signers match the Rust probe verifier for local and managed smoke flows
- root public-facing metadata now includes `SECURITY.md`, `CHANGELOG.md`, and stronger contributor guidance so the repo is closer to GitHub/public launch shape
- the browser-audit image publish workflow now also watches workspace dependency inputs like `packages/contracts`, the root `package.json`, and `bun.lock` so GHCR refreshes do not miss compatible runtime changes
- the console IA now has a real route split around `/`, `/resources`, `/checks`, `/reports`, and `/regions`, backed by a shared workspace component and route-loader helper
- `packages/ui` now drives a shared token/theme system for both OSS and cloud apps, with Tailwind v4 entrypoints and minimal shadcn-compatible primitive exports
- `packages/ui` now also acts as the canonical shared shadcn surface for both repos, with `tabs`, `scroll-area`, `dialog`, `popover`, `tooltip`, `checkbox`, `switch`, and `table` joined by jsrepo-managed `underline-tabs`, `field-set`, `number-field`, `tags-input`, and `copy-button`
- the self-host console now uses those shared components directly through `@webperf/ui/components/ui/*`, with route-level operators also adopting shared number fields, tags input, tables, copy buttons, and action buttons instead of ad hoc controls
- `packages/ui` now also exposes shared operator composites under `@webperf/ui/components/operator/*`, and the self-host console uses those for metric strips, quick region picks, run status cards, saved-check summaries, comparison panels, and derived-resource browsing
- `packages/ui` now also carries second-wave setup/operator composites for resource workflow strips, inventory strips, editor panels, and paged list toolbars
- the self-host resources surface now uses those shared setup composites, and the parallel local-dev path is now an explicit supported workflow with console/probe override scripts instead of manual port surgery
- the self-host console now keeps most route-specific orchestration in repo-local `src/lib/console-workspace/*.svelte.ts` controllers, leaving `ConsoleWorkspace.svelte` primarily responsible for mode wiring and render composition
- shared operator polish helpers now live in `@webperf/ui/components/operator/*` via `operator-section-header`, `operator-empty-state`, and `inline-status-notice`, keeping section headers, empty states, and inline notices visually aligned across OSS and cloud
- the self-host API now exposes optional direct-run browser-audit resources at `/v1/browser-audits`, persists summaries plus artifact metadata in SQLite, and advertises availability through `/v1/capabilities`
- the self-host console `Reports` surface now includes a direct-run browser-audit tab for launching audits and reviewing recent saved summaries, failures, and artifact pointers
- local dev scripts now preflight the console, API, and probe ports before boot so standalone and parallel workflows fail fast with clear override guidance
- the repo now includes a checked-in `Apache-2.0` `LICENSE`, and the public launch docs no longer treat license selection as an unresolved blocker
- thin app-local `src/lib/components/ui/*` re-export shims now exist for the shared console/marketing surfaces so future shadcn-style expansion can stay app-compatible without forking the shared package
- self-host console smoke, cloud console smoke, and local Bunny-like probe/browser-audit smokes are all green after the shared shadcn rollout

Current local dev entrypoints:
- `bun run dev`
- `bun run dev:browser-audit-worker`
- `bun run dev:parallel:cloud`
- `bun run dev:console`
- `bun run dev:api`
- `bun run dev:scheduler`
- `bun run dev:probe`
- `bun run smoke:console`
- `bun run smoke:console:parallel:cloud`

Current local URLs:
- console: `http://localhost:5173`
- api: `http://127.0.0.1:8788`
- probe: `http://127.0.0.1:8080`
- browser-audit worker when run separately: `http://127.0.0.1:8081`
- parallel-with-cloud console: `http://localhost:4174`
- parallel-with-cloud probe: `http://127.0.0.1:8082`

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
6. keep trimming the repo-local console controllers and route-scoped workspace components now that the main workspace split is in place
7. decide how much of the browser-audit reporting surface should become first-class in self-host APIs without pulling managed orchestration into OSS
8. keep the optional browser-audit worker docs, image metadata, and Compose profile aligned with the OSS/cloud ownership split
9. keep the shared token layer, shadcn component exports, setup/operator composite surface, app-level theme entrypoints, and jsrepo adoption path aligned across the OSS console and the managed cloud consumers
10. keep tightening direct-run browser-audit history/detail UX without pulling managed orchestration concerns into OSS

## Update Protocol

When making meaningful progress, update this file in the same change.
