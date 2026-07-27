# AGENTS.md

Living execution brief for `webperf-selfhosted`.

Last updated: 2026-07-27

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

Current repo state as of 2026-07-26:
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
- pending Sampo changesets now produce one generated `release/sampo` PR, and merging that PR dispatches an idempotent protected release that creates the immutable `v0.x.y` tag before publishing versioned GHCR images
- repository releases now advance an independent root `VERSION` and generate a fingerprint-backed, interruption-safe root changelog entry from pending Sampo changesets, while formal dispatches pin checkout and reusable CI to the exact prepared main commit and pass the reusable workflow's declared package-permission ceiling
- coalesced release-preparation runs now reconcile the current untagged version before newer changesets, resolve its source from the main first-parent commit that changed `VERSION`, keep the source Compose image version synchronized, and require annotated manual tags
- formal release preparation and tag publication now share one tested immutable-tag helper, so existing-tag identity checks cannot drift between the preflight and post-approval jobs
- the initial public-beta changeset set is now consumed into `@webperf/config`, `@webperf/contracts`, and `@webperf/domain-core` `0.2.0` plus `@webperf/report-core` `0.1.1`, with package changelogs and a repository-level `0.2.0` release summary
- probe request signing in `packages/domain-core` now uses stable key ordering so Bun/TypeScript signers match the Rust probe verifier for local and managed smoke flows
- root public-facing metadata now includes `SECURITY.md`, `CHANGELOG.md`, and stronger contributor guidance so the repo is closer to GitHub/public launch shape
- required CI now gates shared development-channel publishing for all six runtime images, so workspace dependency changes cannot leave only part of the runtime set stale
- the GitHub `release` Environment requires `imjlk` approval and accepts only `main` workflow dispatches or `v*.*.*` tags before formal publication
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
- executor-to-API HTTP now requires loopback or an explicit trusted-network opt-in, structured API failures preserve only bounded incident/code correlation, and a 10-second forced-shutdown deadline prevents ignored aborts from hanging container termination
- executor start failures are now persisted as retryable queue outcomes, lease heartbeats require a one-third safety margin and have bounded shutdown cleanup, and handler promises that outlive abort races cannot surface late unhandled rejections
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
- Browser Audit terminal-state semantics now live in the shared contract, while Reports polling validates every response and backs off from one to five seconds when status is unchanged instead of issuing a fixed 180-request burst
- internal workspace packages now consume `@webperf/contracts` through `workspace:*` consistently instead of mixing `file:` and workspace references, which keeps the Bun lockfile stable enough for `bun install --frozen-lockfile` in GitHub Actions
- `ci-selfhost` now validates Compose through the checked-in `compose:config` script, which uses `infra/docker-compose/.env.example` instead of assuming repository-local secrets, requires bounded tmpfs mounts with strict decimal size syntax, and distinguishes unavailable Docker from a definite render failure
- local Browser Audit artifact operations now pin validated, process-owned audit directories across downloads and descriptor-relative deletes, use asynchronous `/proc/self/fd` operations on glibc or musl Linux, cache the macOS native unlink binding, reject directory identity changes, require explicit opt-in for zero-grace orphan removal, and document the API-only Compose volume boundary
- API and Browser Audit redaction now preserve JSON reserved keys safely, fully mask malformed multi-`@` URL credentials, and apply identical short-credential boundary and ASCII-whitespace rules across string and streaming byte paths
- Browser Audit URL-regex waits now use an exact-pinned linear-time engine, cleanup failures emit secret-safe diagnostics, network-policy failures use typed classification, and the release guard checks the Docker Chrome pin against locked Puppeteer
- the Reports Browser Audit controller now runtime-validates create and polling payloads, keeps queued and terminal audit outcomes distinct from their respective refresh failures, bounds displayed API errors, caps individual status requests and consecutive 5xx checks, and tells operators to refresh after the overall polling deadline
- local artifact reconciliation now preserves non-owned root entries, rejects dot-only display filenames, and revalidates intermediate audit directories before downloads or deletes
- executor lease renewal now retries only transient API failures inside a conservative local lease deadline, while fatal process events enter the same bounded graceful-shutdown path with structured diagnostics
- webhook delivery now requires HTTPS by default, with a separate explicit legacy-HTTP opt-in that does not relax public-address pinning or redirect blocking
- artifact publication now rejects duplicate filesystem identities without replacing bytes, classifies the SQLite artifact-cap trigger only when both its constraint code and immutable marker match, persists a redacted plaintext URL index beside an encrypted canonical payload, repairs partially synchronized cancellations idempotently, bounds persisted artifact kinds and execution availability through shared contracts, removes stale response digests after redaction, and requires configured webhook signing secrets to contain at least 16 characters
- the Lighthouse runner now URL-encodes every artifact upload path/query value, uploads ordinary `Uint8Array` payloads without a redundant copy, cancels rejected upload bodies, validates press keys against the pinned Puppeteer layout, clears complete fields with a platform-appropriate select-all chord, rejects waits above the per-step limit, bounds every interactive step plus screenshot/trace/report finalization by the shared audit deadline, models user-flow payloads without `any`, resumes short-secret redaction after unmatched quotes, and closes CONNECT work across DNS/client races while bounding authority and HTTP framing inputs
- Compose validation now enforces dropped Linux capabilities for every production service, permits only the Chromium runner's exact `SYS_CHROOT` sandbox exception, and identifies each invalid field
- Browser Audit compatibility parsing now requires at least one actual legacy toolchain version before inferring Lighthouse, and artifact locator storage segments retain an explicit 160-character contract bound
- executor outbound policy classification now shares one hostname normalizer with the DNS-pinned transport so bracket, case, and trailing-dot handling cannot drift between trust decisions; IPv6 loopback is compared through canonical address words, and insecure-runner warnings fire only for an active plain-HTTP origin
- the consolidated CI workflow now caches Bun dependencies for documentation checks, annotates the pinned Rust toolchain action, and bounds the required aggregate gate with an explicit one-minute timeout
- SQLite startup now verifies its synchronous durability mode and identifies failed migrations, retention tolerates intentionally restored partial schemas, and restore performs fail-closed encrypted-payload verification under an operator-adjustable 100,000-row bound while preserving the documented stopped-writer requirement
- bounded JSON parsing now cancels and unlocks request streams on transport failures as well as byte-limit rejection, while encrypted envelope parsing expresses its post-length-check segment invariant without misleading fallback values
- the Lighthouse image now pins the arm64 Chromium packages to matching immutable main/security snapshots aligned with the locked Puppeteer revision while retaining current Debian runtime libraries from the base image repositories, and every artifact upload consumes only the remaining shared audit deadline (also bounded by upload-token expiry) instead of starting a fresh total timeout
- executor probe and webhook delivery now share a DNS-pinned outbound transport that preserves the original Host/SNI identity, rejects untrusted private or mixed public/private answers, narrowly permits RFC 1918/ULA only for explicit container/LAN probe origins while still blocking metadata and reserved ranges, bounds response reads and deadlines, and never follows webhook redirects; webhook signatures also carry a signed timestamp for receiver-side freshness checks
- descriptor-backed artifact downloads now expose their verified size through `X-WebPerf-Artifact-Bytes`, since Bun intentionally uses chunked transfer encoding for the O_NOFOLLOW-backed stream
- Rust probe configuration now redacts current and rotation secrets from `Debug`, rejects whitespace-only rotation keys with diagnostics that explain its trimmed byte requirement, and explicitly keeps negotiated TLS metadata nullable instead of synthesizing it from the request URL
- scheduler failures now retain only bounded, credential-redacted diagnostics and explicitly observe abort-losing promises, while debug Compose proxies keep every path on the configured origin and strip hop-by-hop headers in both directions
- scheduler/executor process heartbeats now publish same-directory O_NOFOLLOW/O_EXCL private temporary files through fsync plus atomic rename, refuse to publish a durable temporary file after its deadline has won so a stale worker cannot look healthy, clean failed publications, keep owner-only permissions, write epoch milliseconds, enforce a bounded write deadline, and contain raw write details plus synchronous or asynchronous logger failures behind generic diagnostics; API boolean parsing accepts normalized operator input and artifact byte defaults/ceilings are named separately
- execution payload contracts reject reserved prototype keys and custom prototypes at every nesting level, artifact locator IDs match filesystem segment rules, retry timing has one documented shared default, and partial legacy Lighthouse toolchains normalize with explicit `unknown` versions
- the public-beta review pass now makes the aggregate CI gate fail on every unsuccessful dependency, parses release matrices structurally, and hardens operator init, documentation, Compose, recovery, and smoke helpers against malformed paths, stale files, and hidden port assumptions
- the public-beta review pass now fails closed on oversized or malformed JSON response redaction, bounds recursive redaction, protects newly created SQLite parent directories, verifies connection pragmas, preserves authenticated-payload corruption diagnostics, and restricts the console control URL to a credential-free HTTP(S) origin
- the optional Lighthouse runtime now derives artifact MIME values from the public registry contract so HTML uploads match API grants exactly, and its sandbox discovery covers Debian's arm64 `chromium-sandbox` filename while still requiring a usable helper
- the Lighthouse reference runner now normalizes every mapped-IPv4 form, blocks NAT64/Teredo/6to4 ranges, bounds DNS and CONNECT idle time, explicitly observes lookups and closes sockets left behind by disconnected clients, strips forwarded identity headers, emits bounded safe proxy diagnostics, verifies uploaded artifact digests, and pins the amd64 Chrome revision explicitly
- executor transports now cancel unused response bodies, reject webhook redirects, retain schema mismatch causes without reflecting payloads, record malformed Browser Audit responses with bounded media-type-only diagnostics, accept only explicit single-value outbound header maps, abort active handlers on process shutdown, record repeated critical events during shutdown, fail unsupported kinds without futile retries, fail fast on invalid DNS/request deadlines, settle incomplete response streams, and bound debug-proxy upstream deadlines plus request bodies without logging raw network messages
- release-policy validation now covers shorthand action steps and mutable image tags from any registry, documentation checks cover Windows and reference-style links, standalone console development sources local secrets, and self-host initialization fails clearly on template drift or concurrent output creation
- API JSON reads now enforce streaming byte limits before parsing, execution payloads cap serialized data at 256 KiB, network comparison contexts enforce their coupled fields, and Browser Audit scores cap extension keys while engine-specific artifact kinds use an explicit bounded MIME policy
- API validation now distinguishes missing JSON bodies, constrains extension provider IDs to safe identifiers, fails closed on locked redaction streams, rejects masked webhook placeholders without an existing secret, and records bounded diagnostics for encrypted-row decode failures; manual job queue failures return safe incident IDs instead of reflecting repository errors, while artifact indexes validate contract metadata on both writes and reads and enforce per-audit limits transactionally with the SQLite trigger retained as a cross-process backstop
- Browser Audit Chrome traffic now traverses a per-audit loopback HTTP/CONNECT proxy that validates once and connects to the pinned DNS answer, with proxy bypasses, QUIC, non-proxied WebRTC UDP, popup targets, downloads, mapped private IPv6 forms, and interceptor failures blocked explicitly
- Browser Audit artifact redaction now separates adjacent URLs, applies a fail-closed malformed-URL fallback, and masks short header/cookie values only in quoted or named credential contexts so one-character values cannot corrupt numeric report fields
- the Reports workspace now accepts only HTTP(S) Browser Audit targets, polls only the submitted resource, classifies non-retryable status responses as visible polling failures, cancels polling on a replacement submission or route teardown, and performs full control-data refreshes only when the queued item is first registered or reaches a terminal state
- scheduler and executor containers now publish independent event-loop heartbeat files on their private `/tmp` tmpfs, and Compose marks each worker unhealthy when its own heartbeat becomes stale instead of treating API reachability as worker liveness
- SQLite restore now proves every encrypted payload is compatible with the configured current/next secret before replacement, while artifact reconciliation uses a one-hour freshness grace and race-safe directory removal so concurrent uploads cannot lose newly published files
- SQLite encryption migrations and restore verification now use numeric-rowid keyset batches, retention deletion releases the writer lock every 500 rows, WAL autocheckpoint policy is explicit, missing maintenance targets fail clearly, and restored files keep the private mode applied before atomic replacement
- Browser Audit artifacts now use a dedicated lease-bound endpoint for short-lived upload grants, a traversal-safe local filesystem adapter, SQLite metadata indexes, authenticated API/console downloads, and startup/maintenance retention reconciliation; the general execution context never carries upload credentials, and the storage interface leaves S3-compatible backends as a future extension
- artifact reconciliation pins the private root and every audit directory while enumerating and deleting descriptor-relative entries, classifies every removed entry by its actual type without following symlinks, preserves unsupported names, and isolates unsafe audit directories without blocking the remaining cleanup pass; persisted registry validation consumes the public contract version constant instead of duplicating it
- local artifact writes, reads, publication, cleanup, and directory permission changes now stay bound to pinned `O_NOFOLLOW` directory descriptors through Linux `/proc/self/fd` or macOS `openat`/`linkat`/`unlinkat`, upload-grant validation names every bounded claim while documenting nonce semantics, and SQLite payload crypto rejects weak secrets at its own trust boundary
- local artifact downloads now also reject files that are not process-owned or expose group/other permissions, while macOS directory enumeration preserves simultaneous `readdir` and `closedir` failures instead of hiding descriptor-cleanup diagnostics
- executor transport now includes lease-bound execution context reads, atomic domain-result persistence, and atomic idempotent follow-up enqueueing without giving the executor direct SQLite access
- public-beta hardening is now tracked in `docs/architecture/public-beta-hardening-plan.md`, covering durable execution, strict self-host security, engine-neutral browser audits, local artifacts, versioned Compose/release automation, and operator documentation
- the optional browser runtime is now named `apps/browser-audit-lighthouse` and documented as a Lighthouse reference implementation, while provider-specific cloud config, health schemas, Turnstile/Cloudflare console adapters, and managed smoke/migration scripts have been removed from the self-host boundary
- legacy REST prefixes now emit deprecation, successor-link, and warning headers while canonical Site, Route Group, Region Set, and Check paths remain unmarked
- self-host production startup now requires explicit admin, internal, probe, and browser-audit secrets with optional next-key rotation; the console forwards the admin credential server-side and the scheduler uses the internal credential
- persisted JSON payloads are now AES-256-GCM encrypted with an HKDF-derived v2 key, legacy plaintext/v1 payloads receive a one-time transactional migration before strict plaintext rejection, sensitive headers/cookies/webhook secrets are masked across API/RPC/SSE/export paths, API redaction fails closed for credential-bearing diagnostic text, malformed URL credentials, and camelCase compound secret fields without masking ordinary keyboard-style `key*` fields, Lighthouse artifact redaction also covers short upload tokens in named authorization contexts without corrupting unrelated short values, and `selfhost:init` generates a non-overwriting random Compose env file
- the Rust probe now pins validated DNS addresses into reqwest across redirects and removes queries, credentials, and fragments from reported final URLs, while the Lighthouse runner enforces public-network target/navigation/subresource checks plus download/new-window blocking and an explicit operator allowlist
- `/v1/capabilities` now reports the implemented Fast Check metric surface, keeping TCP/TLS timing and TLS metadata disabled and null until they are actually measured
- the durable execution foundation now defines public-safe execution job contracts and an encrypted SQLite `execution_jobs` state machine with atomic claim, lease renewal, expiry recovery, bounded retry, terminal failure, cancellation, idempotent completion, and retryable terminal Browser Audit resource synchronization that preserves the original completion timestamp
- claim transactions finalize exhausted jobs in bounded batches without starving eligible work, and repository startup verifies the persisted Browser Audit artifact-limit trigger still matches the public contract before accepting writes
- `apps/executor` now provides the internal-secret-authenticated claim/start/renew/complete/fail transport, a single-concurrency lease heartbeat, safe failure logging, and graceful stop-claiming behavior
- Fast Check network measurement, deterministic Check evaluation, and signed idempotent webhook delivery now run through leased executor handlers with atomic domain-resource creation/result persistence; webhook deliveries append atomically without whole-Run lost updates, non-loopback probe HTTP requires an explicit trusted-network opt-in, and the API no longer starts those operations in-process
- direct Browser Audit creation now returns an atomic queued resource, while the executor owns signed runner calls, retry-safe status transitions, terminal lease/cancellation reconciliation, and secret-safe failure persistence; probe and Browser Audit HMAC secrets are no longer present in the API process
- SQLite startup now uses ordered migration files with WAL, busy-timeout, foreign-key, forward-schema refusal, and graceful close semantics; verified backup/restore/doctor/retention/optimize/VACUUM commands share the same database core, and optional startup pre-migration backups preserve existing installs before upgrades
- the scheduler is now a testable internal-token-only dispatch loop with contract-validated responses, a 30-second request-and-body bound, capped outage backoff with headroom above every valid poll interval, abort-aware polling, Error-only abort propagation, and safe diagnostics; the real API integration uses that client, while a process-level recovery test restarts the API three times against one SQLite file and proves an expired running lease is reclaimed by a new executor identity exactly once
- Browser Audit Protocol v1 now normalizes core metrics, scores, open extended metrics, checkpoints, issues, artifacts, timestamps, and engine/browser/runtime/component toolchains; artifact registry v1 keeps standard kinds while accepting safe extensions, legacy Lighthouse-shaped SQLite records normalize on read, and checked-in Lighthouse plus sitespeed.io fixtures prove the public contract is engine-neutral
- production Compose now consumes one versioned GHCR tag for console, API, scheduler, executor, probe, and the optional Lighthouse runner, while `compose.dev.yml` restores source builds for contributor smoke tests
- default Compose publishes only the console on `127.0.0.1`; loopback API/runner access is opt-in through the `debug` profile, and all runtime services now have non-root/read-only policies, health checks, bounded resources, log rotation, and explicit stop behavior
- the optional Lighthouse container now uses Chrome's user-namespace sandbox with no-new-privileges, non-setuid helpers, non-executable temp mounts, no host port, 1 GiB shared memory, one in-flight audit, and no default `SYS_ADMIN`; a semantic Compose check prevents those production invariants from regressing, rejects root UID/GID values, and requires exact development/production service parity
- one required `ci` workflow now gates PRs and `main` on frozen Bun installation, boundary/OpenAPI/TypeScript/Svelte checks, the full Bun test suite, Rust fmt/clippy/tests, public-safe Markdown links, every linux/amd64 runtime image, an additional Lighthouse build on GitHub's native arm64 runner, and both default and Browser Audit Compose smokes
- Compose smoke port-isolation assertions now inspect actual container port bindings instead of relying on version-dependent `docker compose port` output for exposed-but-unpublished ports
- the Lighthouse runner toolchain now reports the Compose-selected WebPerf runtime version instead of reading a missing version from its private package manifest, and release bundles resolve that runtime version alongside image digests
- the Lighthouse image keeps packaged sandbox helpers root-owned but non-setuid, explicitly selects the user-namespace sandbox, and relies on its product-specific Chrome path plus checked-in seccomp and AppArmor policies instead of a privileged helper
- amd64 Lighthouse image builds now install the exact Chrome for Testing revision declared by the locked `puppeteer-core` package rather than following the mutable `stable` channel
- the amd64 Lighthouse image places that pinned browser under `/opt/webperf/chrome` to avoid collisions with host Chrome policy, while production Compose applies a Moby `seccomp/v0.2.1`-based default-deny profile with only Chromium's `clone`, `setns`, and `unshare` namespace operations added; AppArmor 4 hosts use Chromium's service-scoped unconfined `userns` allowlist without disabling the host restriction globally, and the worker remains non-root after dropping every capability and restoring only `SYS_CHROOT`, with neither `SYS_ADMIN` nor `--no-sandbox`
- all Bun runtime Dockerfiles now install from the lockfile with Bun 1.3.13, and the docs gate rejects machine-local absolute paths plus broken repository-relative links
- public-beta tags are accepted only from `main` after Sampo changesets are applied, the tag matches the highest public package version, and the protected `release` environment approves publication; release assets are generated deterministically from six same-commit image digests and attested in GitHub and GHCR
- defensive migration checks now resolve storage crypto only when locked pending work actually runs, self-host init narrows template keys through an explicit allowlist guard, and maintenance reports committed database work separately from retryable artifact reconciliation failures
- the README now starts with operator outcomes, current console screenshots, and a digest-pinned Docker release install; `docs/users` covers the complete install/configure/regions/checks/scheduling/browser-audit/artifact/backup/upgrade/security/troubleshooting/reverse-proxy/cloud decision path, while source setup and release mechanics live under `docs/contributors`
- Browser Audit Compose CI reports bounded host-kernel AppArmor and namespace denial records when sandboxed Chromium health checks fail, so runtime-policy regressions can be diagnosed without weakening the sandbox
- protected release runs `30161891204` and `30191805871` successfully published annotated tags `v0.2.0` and `v0.2.1`; the current `v0.2.1` release includes six immutable multi-architecture GHCR images, a digest-pinned Compose bundle, per-platform SPDX SBOMs, provenance attestations, checksums, and release-scoped runtime metadata
- PRs #4 through #12 closed the local Compose port-isolation, canonical baseline/deterministic analysis, multi-architecture release, release-bundle-version, and generated-secret clean-host evidence gaps; the public-beta hardening plan is complete
- all six GHCR packages are public, and anonymous registry checks verify `0.2.1` manifests for both `linux/amd64` and `linux/arm64`; GitHub-hosted published-bundle smoke run `30197793088` verified the public archive checksums and source metadata with an empty Docker credential directory, four independently generated temporary secrets, and both runtime profiles
- formal releases now finish with a required fresh GitHub-hosted published-bundle smoke for both default and Browser Audit profiles; its bundle-aware harness is separate from a source-pinned checkout that must match the bundle runtime metadata, and the current `v0.2.1` drill passed with independently generated secrets
- issue #14 Phase 1 has started: PR #15 lands the foundation slice by adding the generic runtime region identity (`runtimeRegionIdSchema`, `runtimeRegionLabelSchema`, `runtimeLocationSchema`) to `@webperf/contracts` and the single-region `SELFHOST_REGION_ID`, `SELFHOST_REGION_LABEL`, and `SELFHOST_PROBE_BASE_URL` variables to `@webperf/config`, in parallel with the legacy 41-city enum and `SELFHOST_*_JSON` maps. The default region id is `local` and the default probe origin is loopback, so the bundle no longer makes an unverified Tokyo claim for new single-region installs. PR2 of Phase 1 will remove the legacy enum/JSON variables and move API/executor consumption to this model; PR3 will rework the Console `/regions` workspace into a Runtime Location view, update user/architecture docs, and add the Phase 1 changeset. Per the operator decision, the legacy 3-variable compatibility parser and stored multi-region Check migration are intentionally omitted because there is no production data to preserve.

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

1. run a documented operator backup/restore drill against the released bundle
2. keep the local artifact adapter and engine-neutral protocol stable before considering an S3-compatible backend
3. decide whether stabilized comparison/export resources need richer server-side pagination and filtering

## Update Protocol

When making meaningful progress, update this file in the same change.
