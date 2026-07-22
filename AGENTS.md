# AGENTS.md

Living execution brief for `webperf-selfhosted`.

Last updated: 2026-07-22

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
- `apps/executor`
- `apps/probe-rs`
- `apps/browser-audit-lighthouse`
- `packages/contracts`
- `packages/domain-core`
- `packages/config`
- `packages/report-core`
- `packages/ui`
- `infra/docker-compose`
- `infra/docker`
- `docs`

## Snapshot

Current repo state as of 2026-07-22:
- the console, API service, scheduler, and Rust probe run together locally
- the optional Bun browser-audit Lighthouse runner now also lives here as the runtime/image source of truth, while managed orchestration stays in `webperf.and.guide`
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
- `apps/browser-audit-lighthouse` is optional: it is not part of the default `bun run dev` or default Compose stack, but it can be run directly or via the `browser-audit` Compose profile
- tagged releases now publish digest-bearing `runtime-metadata.json` as the managed runtime handoff, replacing mutable checked-in image refs
- probe request signing in `packages/domain-core` now uses stable key ordering so Bun/TypeScript signers match the Rust probe verifier for local and managed smoke flows
- root public-facing metadata now includes `SECURITY.md`, `CHANGELOG.md`, and stronger contributor guidance so the repo is closer to GitHub/public launch shape
- required CI now gates shared development-channel publishing for all six runtime images, so workspace dependency changes cannot leave only part of the runtime set stale
- the console IA now has a real route split around `/`, `/resources`, `/checks`, `/reports`, and `/regions`, backed by a shared workspace component and route-loader helper
- `packages/ui` now drives a shared token/theme system for both OSS and cloud apps, with Tailwind v4 entrypoints and minimal shadcn-compatible primitive exports
- `packages/ui` now also acts as the canonical shared shadcn surface for both repos, with `tabs`, `scroll-area`, `dialog`, `popover`, `tooltip`, `checkbox`, `switch`, and `table` joined by jsrepo-managed `underline-tabs`, `field-set`, `number-field`, `tags-input`, and `copy-button`
- the self-host console now uses those shared components directly through `@webperf/ui/components/ui/*`, with route-level operators also adopting shared number fields, tags input, tables, copy buttons, and action buttons instead of ad hoc controls
- `packages/ui` now also exposes shared operator composites under `@webperf/ui/components/operator/*`, and the self-host console uses those for metric strips, quick region picks, run status cards, saved-check summaries, comparison panels, and derived-resource browsing
- `packages/ui` now also carries second-wave setup/operator composites for resource workflow strips, inventory strips, editor panels, and paged list toolbars
- the self-host resources surface now uses those shared setup composites, and the parallel local-dev path is now an explicit supported workflow with console/probe override scripts instead of manual port surgery
- the self-host console now keeps most route-specific orchestration in repo-local `src/lib/console-workspace/*.svelte.ts` controllers, leaving `ConsoleWorkspace.svelte` primarily responsible for mode wiring and render composition
- shared operator polish helpers now live in `@webperf/ui/components/operator/*` via `operator-section-header`, `operator-empty-state`, and `inline-status-notice`, keeping section headers, empty states, and inline notices visually aligned across OSS and cloud
- the self-host `Checks` surface is now split into route-local `SavedCheckEditor`, `SavedCheckBrowseToolbar`, `SavedCheckList`, and `SavedCheckEmptyState` components so the route shell no longer mixes the whole browse/editor flow in one block
- the shared `saved-check-summary-card` is now compact and summary-first by default, with explicit expansion for comparison panels, recent run history, per-target details, and secondary actions
- the self-host API now exposes optional direct-run browser-audit resources at `/v1/browser-audits`, persists summaries plus artifact metadata in SQLite, and advertises availability through `/v1/capabilities`
- the self-host console `Reports` surface now includes a direct-run browser-audit tab for launching audits and reviewing recent saved summaries, failures, and artifact pointers
- local dev scripts now preflight the console, API, and probe ports before boot so standalone and parallel workflows fail fast with clear override guidance
- the repo now includes a checked-in `Apache-2.0` `LICENSE`, and the public launch docs no longer treat license selection as an unresolved blocker
- provider-specific deployment walkthroughs now belong on `webperf.and.guide` so the OSS install and runtime docs can stay vendor-neutral even when the cloud site publishes Bunny-specific guides
- thin app-local `src/lib/components/ui/*` re-export shims now exist for the shared console/marketing surfaces so future shadcn-style expansion can stay app-compatible without forking the shared package
- self-host console smoke, cloud console smoke, and local Bunny-like probe/browser-audit smokes are all green after the shared shadcn rollout
- the latest operator design pass tightened `Resources / Checks / Reports` hierarchy, switched the self-host resources surface to the same three-panel layout as cloud, and added shared Tailwind `@source` coverage so package-level shadcn buttons, tabs, and pagers render correctly in both consoles
- the latest shared UI polish pass also softened nested operator/marketing borders, reduced card-within-card contrast in `Checks` and `Reports`, and added mobile screenshot baselines for the self-host console routes under `output/playwright/mobile-baseline`
- shared field-set spacing and number-field chrome now keep editor section titles and `+ / -` page-size controls inset from card borders instead of rendering as double-bordered or border-hugging blocks
- segmented nav pills, inner metric cards, guide rows, and region tiles now use softer shared borders and clearer typography hierarchy so the operator console reads less like stacked outlined boxes
- shared `Tabs` and `UnderlineTabs` now use darker operator-friendly tracks, clearer active/inactive contrast, and stronger underline emphasis so report and derived-resource tab groups no longer wash out against the surrounding cards
- launch docs are now grouped around single-machine quickstart, compose install, optional browser-audit Lighthouse runner enablement, parallel local dev, runtime images, and a frozen public API surface note
- the frozen public API surface note now matches the real v1 shape more closely by treating `runs` as detail resources plus nested check-run lists, and the HTTP integration suite now regression-tests compatibility alias pagination/filtering alongside the primary list resources
- the shared UI package now also owns a `LiveRunTargetCard` operator composite so both OSS and cloud overview streams render the same live regional target card shape
- the regions surface now also uses a shared `RegionContinentCard` operator component so OSS and cloud keep the same region catalog structure
- browser-audit history now surfaces direct-run policy, toolchain, artifact byte sizes, and saved summary context more clearly in the reports workspace
- browser-audit history now also surfaces request headers/cookies/flow context plus normalized issue rows so self-host operators can inspect direct-run failures without needing managed orchestration views
- the root `check` flow now also runs a checked-in OpenAPI regression script so the frozen public/control docs stay aligned with the real contract export paths
- the repo now includes `smoke:compose` and `smoke:compose:browser-audit` helpers that boot the Compose stack with temporary secrets, verify API health, run the console smoke, and exercise direct-run browser-audit in the optional profile
- the repo now also includes `capture:console:baselines` helpers that render `/`, `/resources`, `/checks`, `/reports`, and `/regions` at desktop and mobile sizes into `output/playwright/console-baselines`
- pushes to `main` publish all six runtime images with `main` and `sha-*` development tags after required CI; tagged releases publish version tags, digest-pinned Compose, SPDX SBOMs, provenance, checksums, and release-scoped runtime metadata without a `latest` channel
- the frozen public API docs now explicitly treat `runs` as nested check-run lists plus top-level persisted run detail resources, and the HTTP suite regression-tests `GET /v1/checks/:checkId/runs` paging/filtering alongside the other stabilized list surfaces
- browser-audit history now also surfaces checkpoint summaries, per-header/per-cookie request context, flow-step detail, and clearer artifact pointer labels so direct-run operator debugging stays readable without managed orchestration tooling
- internal workspace packages now consume `@webperf/contracts` through `workspace:*` consistently instead of mixing `file:` and workspace references, which keeps the Bun lockfile stable enough for `bun install --frozen-lockfile` in GitHub Actions
- `ci-selfhost` now validates Compose through the checked-in `compose:config` script, which uses `infra/docker-compose/.env.example` instead of assuming repository-local secrets during static config validation
- Browser Audit artifacts now use a dedicated lease-bound endpoint for short-lived upload grants, a traversal-safe local filesystem adapter, SQLite metadata indexes, authenticated API/console downloads, and startup/maintenance retention reconciliation; the general execution context never carries upload credentials, and the storage interface leaves S3-compatible backends as a future extension
- executor transport now includes lease-bound execution context reads, atomic domain-result persistence, and atomic idempotent follow-up enqueueing without giving the executor direct SQLite access
- public-beta hardening is now tracked in `docs/architecture/public-beta-hardening-plan.md`, covering durable execution, strict self-host security, engine-neutral browser audits, local artifacts, versioned Compose/release automation, and operator documentation
- the optional browser runtime is now named `apps/browser-audit-lighthouse` and documented as a Lighthouse reference implementation, while provider-specific cloud config, health schemas, Turnstile/Cloudflare console adapters, and managed smoke/migration scripts have been removed from the self-host boundary
- legacy REST prefixes now emit deprecation, successor-link, and warning headers while canonical Site, Route Group, Region Set, and Check paths remain unmarked
- self-host production startup now requires explicit admin, internal, probe, and browser-audit secrets with optional next-key rotation; the console forwards the admin credential server-side and the scheduler uses the internal credential
- persisted JSON payloads are now AES-256-GCM encrypted with an HKDF-derived v2 key, legacy plaintext/v1 payloads receive a one-time transactional migration before strict plaintext rejection, sensitive headers/cookies/webhook secrets are masked across API/RPC/SSE/export paths, and `selfhost:init` generates a non-overwriting random Compose env file
- the Rust probe now pins validated DNS addresses into reqwest across redirects, while the Lighthouse runner enforces public-network target/navigation/subresource checks plus download/new-window blocking and an explicit operator allowlist
- `/v1/capabilities` now reports the implemented Fast Check metric surface, keeping TCP/TLS timing and TLS metadata disabled and null until they are actually measured
- the durable execution foundation now defines public-safe execution job contracts and an encrypted SQLite `execution_jobs` state machine with atomic claim, lease renewal, expiry recovery, bounded retry, terminal failure, cancellation, and idempotent completion semantics
- `apps/executor` now provides the internal-secret-authenticated claim/start/renew/complete/fail transport, a single-concurrency lease heartbeat, safe failure logging, and graceful stop-claiming behavior
- Fast Check network measurement, deterministic Check evaluation, and signed idempotent webhook delivery now run through leased executor handlers with atomic domain-resource creation/result persistence; webhook deliveries append atomically without whole-Run lost updates, non-loopback probe HTTP requires an explicit trusted-network opt-in, and the API no longer starts those operations in-process
- direct Browser Audit creation now returns an atomic queued resource, while the executor owns signed runner calls, retry-safe status transitions, terminal lease/cancellation reconciliation, and secret-safe failure persistence; probe and Browser Audit HMAC secrets are no longer present in the API process
- SQLite startup now uses ordered migration files with WAL, busy-timeout, foreign-key, forward-schema refusal, and graceful close semantics; verified backup/restore/doctor/retention/optimize/VACUUM commands share the same database core, and optional startup pre-migration backups preserve existing installs before upgrades
- the scheduler is now a testable internal-token-only dispatch loop with contract-validated responses, a 30-second request-and-body bound, capped outage backoff with headroom above every valid poll interval, abort-aware polling, and safe diagnostics; the real API integration uses that client, while a process-level recovery test restarts the API three times against one SQLite file and proves an expired running lease is reclaimed by a new executor identity exactly once
- Browser Audit Protocol v1 now normalizes core metrics, scores, open extended metrics, checkpoints, issues, artifacts, timestamps, and engine/browser/runtime/component toolchains; artifact registry v1 keeps standard kinds while accepting safe extensions, legacy Lighthouse-shaped SQLite records normalize on read, and checked-in Lighthouse plus sitespeed.io fixtures prove the public contract is engine-neutral
- production Compose now consumes one versioned GHCR tag for console, API, scheduler, executor, probe, and the optional Lighthouse runner, while `compose.dev.yml` restores source builds for contributor smoke tests
- default Compose publishes only the console on `127.0.0.1`; loopback API/runner access is opt-in through the `debug` profile, and all runtime services now have non-root/read-only policies, health checks, bounded resources, log rotation, and explicit stop behavior
- the optional Lighthouse container now prepares Chrome's setuid sandbox, stays host-port free with 1 GiB shared memory and one in-flight audit, and no longer receives default `SYS_ADMIN`; a semantic Compose check prevents those production invariants from regressing
- one required `ci` workflow now gates PRs and `main` on frozen Bun installation, boundary/OpenAPI/TypeScript/Svelte checks, all 96 Bun tests, Rust fmt/clippy/tests, public-safe Markdown links, every linux/amd64 runtime image, and both default and Browser Audit Compose smokes
- all Bun runtime Dockerfiles now install from the lockfile with Bun 1.3.13, and the docs gate rejects machine-local absolute paths plus broken repository-relative links
- public-beta tags are accepted only from `main` after Sampo changesets are applied, the tag matches the highest public package version, and the protected `release` environment approves publication; release assets are generated deterministically from six same-commit image digests and attested in GitHub and GHCR

Current local dev entrypoints:
- `bun run dev`
- `bun run dev:browser-audit-lighthouse`
- `bun run dev:parallel`
- `bun run dev:console`
- `bun run dev:api`
- `bun run dev:scheduler`
- `bun run dev:executor`
- `bun run dev:probe`
- `bun run smoke:console`
- `bun run smoke:console:parallel`
- `bun run smoke:compose`
- `bun run smoke:compose:browser-audit`
- `bun run capture:console:baselines`

Current local URLs:
- console: `http://localhost:5173`
- api: `http://127.0.0.1:8788`
- probe: `http://127.0.0.1:8080`
- browser-audit Lighthouse runner when run separately: `http://127.0.0.1:8081`
- parallel console: `http://localhost:4174`
- parallel probe: `http://127.0.0.1:8082`

The API and Browser Audit URLs above describe standalone development. Default
Compose publishes only `http://127.0.0.1:5173`; its API and runner addresses
exist on the host only while their loopback `debug` proxies are enabled.

## Working Rules

- keep the repo self-host coherent
- avoid adding managed runtime assumptions into public packages
- prefer extracting reusable logic into `packages/domain-core` or `packages/report-core`
- keep setup simple enough for a small single-org deployment
- keep public packages as the source of truth that cloud code consumes rather than forks
- keep browser-audit extension points vendor-neutral and optional
- keep AI-specific product logic out of the OSS core

## Immediate Next Tasks

1. execute the staged checklist in `docs/architecture/public-beta-hardening-plan.md`
2. validate the default and Browser Audit source-build Compose smokes in CI
3. publish release images, SBOM, provenance, and digest metadata only after the reusable CI gate
4. complete the operator install, backup, upgrade, security, and troubleshooting documentation
5. keep the local artifact adapter and engine-neutral protocol stable before considering an S3-compatible backend

## Update Protocol

When making meaningful progress, update this file in the same change.
