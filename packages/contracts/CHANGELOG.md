# @webperf/contracts

## 0.5.0 — 2026-08-02

### Minor changes

- [ba45816](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/ba458160908e9367d5f3fbea909e995d88775334) Add date-range (`createdAfter`/`createdBefore`) and exact `checkId`
  filtering to the comparison, export, and analysis list endpoints. The new
  `derivedResourceListQuerySchema` extends the shared `listQuerySchema`
  with these optional fields, and `applyDerivedResourceListQuery` in
  `@webperf/domain-core` applies them before text-search and pagination. — Thanks @imjlk!

## 0.4.0 — 2026-07-30

### Minor changes

- [79c7400](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/79c740035b3cfa83fd849bef14b23b919facf3e8) Publish the stateless `webperf-probe` capability contract used by both
  self-hosted WebPerf and WebPerf & Guide Managed. The Rust probe now
  reports its configured region, immutable runtime provenance, transport limits,
  and admission limit, echoes correlation identifiers in measurement responses,
  rejects mismatched regions, and fails fast with `429` when its configurable
  in-flight guard is exhausted. Its Rust wire format rejects explicit null
  request configurations and its documented four-hop redirect allowance now
  follows all four redirects before rejecting a fifth. Request buffering is
  admitted through a separate fixed memory budget with a bounded body-read
  deadline, and lifecycle timeouts retain the last validated redirect URL and
  redirect count for managed-service diagnostics. The self-host executor verifies
  echoed job and target correlation identifiers when present while continuing to
  accept legacy probe responses that omit them. — Thanks @imjlk!
- [79c7400](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/79c740035b3cfa83fd849bef14b23b919facf3e8) Remove the superseded Regional Runtime API, contracts, execution mode, and
  deployment profile. WebPerf Self-hosted remains a complete single-location
  application, while WebPerf & Guide Managed orchestrates the
  versioned stateless `webperf-probe` image through its private control plane.
  Released SQLite migrations and retention cleanup remain compatible with
  databases created by WebPerf 0.3.0. — Thanks @imjlk!

## 0.3.0 — 2026-07-30

### Minor changes

- [1ad632a](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/1ad632a0a16f4ad62d102ed7cfc1c980ab51aefb) Add the regional runtime handoff protocol contracts. Define a
  provider-neutral execution boundary (`regionalRuntimeCapabilitiesSchema`,
  `regionalExecutionRequestSchema`, `regionalExecutionResultSchema`,
  `regionalExecutionStatusSchema`) that a managed Cloud control plane can
  call to submit signed, idempotent network-probe requests to one regional
  runtime. The API now exposes contract-backed capabilities, create, status,
  and cancel routes plus a dedicated OpenAPI document. It persists encrypted
  idempotency records, atomically gives every target its own durable retry
  budget, retains completed sibling results while a regional request can
  still resume, enforces replay and execution deadlines, normalizes semantic
  request defaults, supports current/next key rotation, and signs results
  with distinct runtime/runner image provenance. Browser Audit is
  intentionally deferred to a separate request variant. Tagged releases now
  include the digest-pinned three-container Regional Runtime profile,
  pre-populated provenance digests, synchronized source environment versions,
  and a dedicated published-bundle smoke. No Cloud-only logic (billing,
  tenancy, fleet) enters this repository. — Thanks @imjlk!
- [71ed002](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/71ed0027219b52725c9b9f42a627959463677e17) Remove the legacy 41-city region catalog, Region Pack/Region Set resources,
  and multi-region selection from the self-host product. One standalone
  deployment now measures from one fixed runtime location identified by
  `SELFHOST_REGION_ID` (default `local`) and optional `SELFHOST_REGION_LABEL`;
  the executor reads one `SELFHOST_PROBE_BASE_URL` origin; and the Rust probe
  reads `REGION_ID` instead of `REGION_CODE`. The `/v1/region-packs` and
  `/v1/region-sets` routes return 410 Gone. `createLatencyJobSchema.regions`,
  `checkProfileSchema.regionPackId`, `regionPackSchema`, `regionCodeSchema`,
  the `regionCatalog`/`buildRegionAvailabilityList`/`resolveRequestedRegions`
  helpers, and the Console region catalog UI are removed. Result provenance
  keeps a single `region` field per job, target, and Browser Audit. This is a
  breaking change for self-host installs that relied on the multi-region
  SaaS fan-out model; there is no production data to migrate. — Thanks @imjlk!
- [de7b47f](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/de7b47fca7d76ff49035b69f5c25379c3667d846) Add an authenticated, provider-neutral runtime metrics contract at
  `GET /v1/runtime-metrics` for both full self-host installations and
  restricted regional runtimes. The snapshot reports durable execution queue
  pressure, status and runner-kind counts, retry and expired-lease signals,
  oldest-work ages, retention context, and the current single-replica SQLite
  capacity boundary without exposing targets or persisted payloads.
  
  Published release bundles now gate upgrades from the public `v0.2.1`
  multi-region beta. The migration preserves historical target provenance,
  requires explicit operator review before unsafe saved checks can run again,
  creates a pre-migration backup, and is covered by automated backup, restore,
  and cross-version Compose drills. Self-host documentation and console copy
  now consistently describe one deployment as one fixed measurement location. — Thanks @imjlk!

### Patch changes

- [90350cf](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/90350cf9a9dfd8928459fab8431d01c9d86ef865) Add the generic runtime region identity foundation that one standalone
  deployment will own, in parallel with the legacy 41-city enum and
  SELFHOST_*_JSON maps. Introduces `runtimeRegionIdSchema`,
  `runtimeRegionLabelSchema`, and `runtimeLocationSchema` in `@webperf/contracts`,
  plus `SELFHOST_REGION_ID`, `SELFHOST_REGION_LABEL`, and
  `SELFHOST_PROBE_BASE_URL` in `@webperf/config` (default region id `local`,
  no unverified city claim). This is the foundation slice of issue #14
  Phase 1; the legacy multi-region model is removed in a follow-up PR. — Thanks @imjlk!

## 0.2.0 — 2026-07-25

### Minor changes

- [60b6499](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/60b64999e69784397ba7090af79789280afad56d) Add execution-scoped Browser Audit artifact upload contracts, local-filesystem storage configuration, SQLite metadata indexes, authenticated streaming downloads, retention reconciliation, and operator documentation. — Thanks @imjlk!
- [7bbee00](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/7bbee00bae7be420858f0dcc9eb7137147e8bb42) Require explicit self-host credentials, publish truthful Fast Check metric capabilities, encrypt persisted payloads, redact sensitive values, and enforce public-network SSRF policies. — Thanks @imjlk!
- [f25287d](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/f25287d270d80305129821c230ea535b2774c26e) Publish the durable execution job state machine, lease-bound internal transport contracts, executor runtime configuration, retry-safe network probe, Browser Audit, evaluation, and webhook handlers, ordered SQLite migrations and operator database commands, plus a contract-validated scheduler-only dispatch boundary and restart-recovery integration coverage. — Thanks @imjlk!
- [93a8f18](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/93a8f18e6b9dd793a05df6f70b779de587a8633b) Publish Browser Audit Protocol v1 with engine-neutral metrics, scores, checkpoints, toolchains, extensible artifact kinds, legacy persisted-result normalization, and Lighthouse plus sitespeed.io compatibility fixtures. — Thanks @imjlk!
- [21d2512](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/21d25127478bdbaff23e6e9eded4d30518707718) Make the self-hosted boundary provider-neutral and rename the optional browser audit runtime as the Lighthouse reference runner. — Thanks @imjlk!
