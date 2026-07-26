# Changelog

All notable WebPerf self-hosted changes are recorded here. Package-level
versioning and changelogs are generated from
[Sampo](https://github.com/bruits/sampo) changesets.

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
