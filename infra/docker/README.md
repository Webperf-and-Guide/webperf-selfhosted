# Docker image sources

The Dockerfiles in this repository build the six self-host runtime images:

- console
- API
- scheduler
- executor
- Rust probe
- optional Lighthouse reference runner

All release images target `linux/amd64`. The production Compose source uses a
single version placeholder, while each downloadable release bundle rewrites
all image references to the OCI digests produced for that tagged commit.

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
