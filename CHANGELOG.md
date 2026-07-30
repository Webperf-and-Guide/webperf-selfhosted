# Changelog

All notable WebPerf self-hosted changes are recorded here. Package-level
versioning and changelogs are generated from
[Sampo](https://github.com/bruits/sampo) changesets.

## [0.3.0] — 2026-07-30

### Changes

- Add the regional runtime handoff protocol contracts. Define a provider-neutral execution boundary (`regionalRuntimeCapabilitiesSchema`, `regionalExecutionRequestSchema`, `regionalExecutionResultSchema`, `regionalExecutionStatusSchema`) that a managed Cloud control plane can call to submit signed, idempotent network-probe requests to one regional runtime. The API now exposes contract-backed capabilities, create, status, and cancel routes plus a dedicated OpenAPI document. It persists encrypted idempotency records, atomically gives every target its own durable retry budget, retains completed sibling results while a regional request can still resume, enforces replay and execution deadlines, normalizes semantic request defaults, supports current/next key rotation, and signs results with distinct runtime/runner image provenance. Browser Audit is intentionally deferred to a separate request variant. Tagged releases now include the digest-pinned three-container Regional Runtime profile, pre-populated provenance digests, synchronized source environment versions, and a dedicated published-bundle smoke. No Cloud-only logic (billing, tenancy, fleet) enters this repository.
- Add `SELFHOST_RUNTIME_MODE` (`full` | `regional-runtime`, default `full`) to the self-host API environment schema. When set to `regional-runtime`, the deployment serves as a regional execution runtime for the managed Cloud control plane and requires an isolated current/next handoff secret. The `WEBPERF_ROLE=regional-runtime` dispatcher now forces the restricted mode so role selection cannot accidentally expose the full self-host surface, while optional immutable image metadata supports result provenance. The restricted role no longer requires the unused self-host administrator credential, and executors without a Browser Audit origin no longer require an unused Browser Audit secret.
- Add an authenticated, provider-neutral runtime metrics contract at `GET /v1/runtime-metrics` for both full self-host installations and restricted regional runtimes. The snapshot reports durable execution queue pressure, status and runner-kind counts, retry and expired-lease signals, oldest-work ages, retention context, and the current single-replica SQLite capacity boundary without exposing targets or persisted payloads. Published release bundles now gate upgrades from the public `v0.2.1` multi-region beta. The migration preserves historical target provenance, requires explicit operator review before unsafe saved checks can run again, creates a pre-migration backup, and is covered by automated backup, restore, and cross-version Compose drills. Self-host documentation and console copy now consistently describe one deployment as one fixed measurement location.
- Remove the legacy 41-city region catalog, Region Pack/Region Set resources, and multi-region selection from the self-host product. One standalone deployment now measures from one fixed runtime location identified by `SELFHOST_REGION_ID` (default `local`) and optional `SELFHOST_REGION_LABEL`; the executor reads one `SELFHOST_PROBE_BASE_URL` origin; and the Rust probe reads `REGION_ID` instead of `REGION_CODE`. The `/v1/region-packs` and `/v1/region-sets` routes return 410 Gone. `createLatencyJobSchema.regions`, `checkProfileSchema.regionPackId`, `regionPackSchema`, `regionCodeSchema`, the `regionCatalog`/`buildRegionAvailabilityList`/`resolveRequestedRegions` helpers, and the Console region catalog UI are removed. Result provenance keeps a single `region` field per job, target, and Browser Audit. This is a breaking change for self-host installs that relied on the multi-region SaaS fan-out model; there is no production data to migrate.
- Add the generic runtime region identity foundation that one standalone deployment will own, in parallel with the legacy 41-city enum and SELFHOST_*_JSON maps. Introduces `runtimeRegionIdSchema`, `runtimeRegionLabelSchema`, and `runtimeLocationSchema` in `@webperf/contracts`, plus `SELFHOST_REGION_ID`, `SELFHOST_REGION_LABEL`, and `SELFHOST_PROBE_BASE_URL` in `@webperf/config` (default region id `local`, no unverified city claim). This is the foundation slice of issue #14 Phase 1; the legacy multi-region model is removed in a follow-up PR.
- Consolidate four Bun runtime images into one `webperf` image and embed the scheduler in the API. The published GHCR image set changes from six images (`webperf-console`, `webperf-api`, `webperf-scheduler`, `webperf-executor`, `webperf-probe`, `webperf-browser-audit-lighthouse`) to three (`webperf`, `webperf-probe`, `webperf-browser-audit-lighthouse`). Console, API, scheduler, and executor are now runtime roles selected by the `WEBPERF_ROLE` environment variable in the single `webperf` image. The scheduler defaults to embedded mode inside the API process (`SELFHOST_SCHEDULER_MODE=embedded`); external mode remains available. This is a breaking change for consumers pinned to the old six-image digest-pinned Compose bundle.

<!-- webperf-release: from=0.2.1; changesets=sha256:8eeb9b22208fdfb96431c44ad5f9f433738002e9cc428bd8a9c7c4c9ba96d193 -->

## [0.2.1] — 2026-07-26

### Changes

- Publish every self-host runtime image for Linux amd64 and arm64, and verify the published OCI index before releasing its digest-pinned Compose bundle.

<!-- webperf-release: from=0.2.0; changesets=sha256:5ac22054af8b14de08123078741fdda828646261467334da53ff2ab44a7c01cf -->

## [0.2.0] — 2026-07-25

First public-beta release of the complete self-hosted runtime.

### Added

- Durable, lease-bound execution for Fast Checks, Browser Audits, deterministic
  evaluation, and signed webhook delivery, with SQLite recovery and operator
  database tooling.
- Browser Audit Protocol v1, including engine-neutral metrics, checkpoints,
  toolchains, extensible artifacts, legacy normalization, and reference
  Lighthouse plus sitespeed.io fixtures.
- Execution-scoped Browser Audit artifact grants, traversal-safe local storage,
  authenticated downloads, persisted metadata, and retention reconciliation.
- A production Compose bundle for all six runtimes with hardened containers,
  health checks, bounded resources, debug overrides, and an optional sandboxed
  Lighthouse profile.
- Complete self-host operator documentation for installation, configuration,
  regions, checks, schedules, Browser Audits, recovery, upgrades, security, and
  troubleshooting.

### Security

- Explicit self-host credentials, encrypted persisted payloads, secret
  redaction, public-network SSRF controls, and truthful Fast Check capability
  reporting.

### Changed

- Kept the public self-host boundary provider-neutral and made the optional
  Lighthouse runtime a reference implementation.
- Added Sampo release-PR automation and a protected, idempotent release path
  that publishes six immutable GHCR images, SBOMs, provenance attestations,
  checksums, and a digest-pinned Compose bundle.

### Package versions

- `@webperf/config`: `0.2.0`
- `@webperf/contracts`: `0.2.0`
- `@webperf/domain-core`: `0.2.0`
- `@webperf/report-core`: `0.1.1`

[0.2.0]: https://github.com/Webperf-and-Guide/webperf-selfhosted/releases/tag/v0.2.0
[0.2.1]: https://github.com/Webperf-and-Guide/webperf-selfhosted/releases/tag/v0.2.1
[0.3.0]: https://github.com/Webperf-and-Guide/webperf-selfhosted/releases/tag/v0.3.0
