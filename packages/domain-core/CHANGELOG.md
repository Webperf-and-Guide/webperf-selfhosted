# @webperf/domain-core

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
- [f48c411](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/f48c4113489da9c6760cdb6cb43902b4d2e56464) Consolidate four Bun runtime images into one `webperf` image and embed the
  scheduler in the API. The published GHCR image set changes from six images
  (`webperf-console`, `webperf-api`, `webperf-scheduler`, `webperf-executor`,
  `webperf-probe`, `webperf-browser-audit-lighthouse`) to three
  (`webperf`, `webperf-probe`, `webperf-browser-audit-lighthouse`). Console,
  API, scheduler, and executor are now runtime roles selected by the
  `WEBPERF_ROLE` environment variable in the single `webperf` image. The
  scheduler defaults to embedded mode inside the API process
  (`SELFHOST_SCHEDULER_MODE=embedded`); external mode remains available.
  This is a breaking change for consumers pinned to the old six-image
  digest-pinned Compose bundle. — Thanks @imjlk!

### Patch changes

- Updated dependencies: contracts@0.3.0

## 0.2.0 — 2026-07-25

### Minor changes

- [21d2512](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/21d25127478bdbaff23e6e9eded4d30518707718) Make the self-hosted boundary provider-neutral and rename the optional browser audit runtime as the Lighthouse reference runner. — Thanks @imjlk!

### Patch changes

- Updated dependencies: contracts@0.2.0
