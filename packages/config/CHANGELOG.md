# @webperf/config

## 0.4.2 — 2026-08-02

### Patch changes

- [3283567](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/3283567b319b9c00edcb28033d6c361c81fa92f0) Keep native main development-image publishing independent from source-pinned
  formal release validation, and clarify that protected releases publish GHCR
  images while npm package publication remains a separate future concern. — Thanks @imjlk!

## 0.4.1 — 2026-08-02

### Patch changes

- [db51124](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/db511247f55d104221c281924b4923cd15045411) Reduce the consolidated `webperf` runtime image from 426 MB to 381 MB by
  using the Bun slim runtime base and excluding console build intermediates,
  without removing production dependencies or runtime capabilities. — Thanks @imjlk!
- [db51124](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/db511247f55d104221c281924b4923cd15045411) Set `v0.4.0` as the minimum supported direct-upgrade baseline and make formal
  releases prove same-volume data preservation with the consolidated runtime.
  The retired split-role GHCR packages are no longer release dependencies. — Thanks @imjlk!
- Updated dependencies: contracts@0.5.0

## 0.4.0 — 2026-07-30

### Minor changes

- [79c7400](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/79c740035b3cfa83fd849bef14b23b919facf3e8) Remove the superseded Regional Runtime API, contracts, execution mode, and
  deployment profile. WebPerf Self-hosted remains a complete single-location
  application, while WebPerf & Guide Managed orchestrates the
  versioned stateless `webperf-probe` image through its private control plane.
  Released SQLite migrations and retention cleanup remain compatible with
  databases created by WebPerf 0.3.0. — Thanks @imjlk!
- [79c7400](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/79c740035b3cfa83fd849bef14b23b919facf3e8) Make the default self-host deployment a true two-container stack: one
  supervised `webperf` container for the console, API, embedded scheduler, and
  durable executor, plus the separate Rust `webperf-probe` trust boundary. The
  optional Lighthouse Browser Audit runner remains a third profile container,
  and split `webperf` roles remain available for development and maintenance.
  The standalone supervisor launches the public console, API, and executor under
  distinct non-root UIDs with only the capabilities needed to set those
  identities and stop its children. It keeps the API and console available while
  waiting for the separate probe to become healthy, then starts the executor so
  routine stack startups do not exhaust queued work attempts. Database maintenance
  and recovery commands continue to run as the persistent data owner rather than
  inheriting the supervisor identity. Custom-Compose upgrade guidance now states
  the exact supervisor identity, capability, and `no-new-privileges` boundary
  required by the standalone role, migrates copied internal API origins from the
  retired `api` service to `webperf`, stages restore snapshots through the data
  owner identity, and starts the separate probe before waiting on standalone
  health in the cross-version drill. — Thanks @imjlk!

### Patch changes

- Updated dependencies: contracts@0.4.0

## 0.3.0 — 2026-07-30

### Minor changes

- [ae8d021](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/ae8d02142eb7223a4f35d4a666bb0b396beb956c) Add `SELFHOST_RUNTIME_MODE` (`full` | `regional-runtime`, default `full`)
  to the self-host API environment schema. When set to `regional-runtime`,
  the deployment serves as a regional execution runtime for the managed
  Cloud control plane and requires an isolated current/next handoff secret.
  The `WEBPERF_ROLE=regional-runtime` dispatcher now forces the restricted
  mode so role selection cannot accidentally expose the full self-host
  surface, while optional immutable image metadata supports result
  provenance. The restricted role no longer requires the unused self-host
  administrator credential, and executors without a Browser Audit origin no
  longer require an unused Browser Audit secret. — Thanks @imjlk!
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

- [90350cf](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/90350cf9a9dfd8928459fab8431d01c9d86ef865) Add the generic runtime region identity foundation that one standalone
  deployment will own, in parallel with the legacy 41-city enum and
  SELFHOST_*_JSON maps. Introduces `runtimeRegionIdSchema`,
  `runtimeRegionLabelSchema`, and `runtimeLocationSchema` in `@webperf/contracts`,
  plus `SELFHOST_REGION_ID`, `SELFHOST_REGION_LABEL`, and
  `SELFHOST_PROBE_BASE_URL` in `@webperf/config` (default region id `local`,
  no unverified city claim). This is the foundation slice of issue #14
  Phase 1; the legacy multi-region model is removed in a follow-up PR. — Thanks @imjlk!
- Updated dependencies: contracts@0.3.0

## 0.2.1 — 2026-07-26

### Patch changes

- [f8672b5](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/f8672b51d4f6fc71b07152e1f682686c8b87a8fe) Publish every self-host runtime image for Linux amd64 and arm64, and verify the
  published OCI index before releasing its digest-pinned Compose bundle. — Thanks @imjlk!

## 0.2.0 — 2026-07-25

### Minor changes

- [60b6499](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/60b64999e69784397ba7090af79789280afad56d) Add execution-scoped Browser Audit artifact upload contracts, local-filesystem storage configuration, SQLite metadata indexes, authenticated streaming downloads, retention reconciliation, and operator documentation. — Thanks @imjlk!
- [7bbee00](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/7bbee00bae7be420858f0dcc9eb7137147e8bb42) Require explicit self-host credentials, publish truthful Fast Check metric capabilities, encrypt persisted payloads, redact sensitive values, and enforce public-network SSRF policies. — Thanks @imjlk!
- [f25287d](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/f25287d270d80305129821c230ea535b2774c26e) Publish the durable execution job state machine, lease-bound internal transport contracts, executor runtime configuration, retry-safe network probe, Browser Audit, evaluation, and webhook handlers, ordered SQLite migrations and operator database commands, plus a contract-validated scheduler-only dispatch boundary and restart-recovery integration coverage. — Thanks @imjlk!
- [5c6b4f1](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/5c6b4f19554c90f024a02afb731dff98f9768425) Ship a versioned GHCR production Compose bundle with a source-build override, console-only loopback exposure, opt-in debug proxies, non-root read-only services, health checks, bounded resources, log rotation, and a sandboxed single-concurrency Lighthouse profile without default `SYS_ADMIN`. — Thanks @imjlk!
- [589ef9d](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/589ef9df2fa4bcd481786fa3fb08af967e8a1d69) Gate all development and tagged image publishing on required CI, automate Sampo release PR preparation and protected formal-release dispatch, publish six versioned GHCR images with SBOM and provenance attestations, and ship a deterministic digest-pinned Compose bundle with release-scoped runtime metadata and checksums. — Thanks @imjlk!
- [5563286](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/5563286a6326dfa720e95a73096932e6dcf53995) Make the public README Docker-first and add complete operator guides for installation, configuration, regions, checks, scheduling, Browser Audits, artifacts, backup and restore, upgrades, security, troubleshooting, reverse proxying, and the self-hosted/cloud boundary. — Thanks @imjlk!
- [21d2512](https://github.com/Webperf-and-Guide/webperf-selfhosted/commit/21d25127478bdbaff23e6e9eded4d30518707718) Make the self-hosted boundary provider-neutral and rename the optional browser audit runtime as the Lighthouse reference runner. — Thanks @imjlk!
