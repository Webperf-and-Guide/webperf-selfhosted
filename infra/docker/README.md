# Docker image sources

The Dockerfiles in this repository build the three self-host runtime images:

- `webperf` — a single multi-role Bun image covering the console, API,
  scheduler, and executor. The active role is selected at container start by
  the `WEBPERF_ROLE` environment variable (`console`, `api`, `scheduler`, or
  `executor`) via the `tooling/scripts/webperf-role.ts` dispatcher.
- Rust probe
- optional Lighthouse reference runner

Every release image is a multi-platform OCI index for `linux/amd64` and
`linux/arm64`. The production Compose source uses a single version placeholder,
while each downloadable release bundle rewrites all image references to the OCI
digests produced for that tagged commit.

The [CI workflow](../../.github/workflows/ci.yml) publishes the `main` and
source-SHA development channels only after required checks pass. The
[release workflow](../../.github/workflows/release.yml) publishes versioned
images, SBOMs, provenance, and digest-bearing runtime metadata.

The managed product consumes `runtime-metadata.json` from a specific GitHub
Release. Managed orchestration stays in the cloud repository; reusable runtime
sources and Dockerfiles stay here.

For installation and local-build commands, see
[runtime images and releases](../../docs/quickstart/runtime-images.md) and the
[Compose bundle](../docker-compose/README.md).
