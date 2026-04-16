# Docker notes

The runtime images in this repo are:

- `ghcr.io/webperf-and-guide/webperf-probe`
- `ghcr.io/webperf-and-guide/webperf-browser-audit-worker`

Recommended builds:

- `docker buildx build --platform linux/amd64 -f apps/probe-rs/Dockerfile .`
- `docker buildx build --platform linux/amd64 -f apps/browser-audit-worker/Dockerfile .`

Ownership rules:

- this repo is the source of truth for both runtime images
- `webperf.and.guide` consumes those images through `BUNNY_PROBE_IMAGE` and `BUNNY_BROWSER_AUDIT_IMAGE`
- `webperf.and.guide` also reads `infra/docker/metadata/*.json` as the canonical checked-in image refs for Cloudflare/Bunny config rendering
- managed orchestration stays in the cloud repo, but the reusable runtime sources and Dockerfiles stay here
- Bunny Magic Containers only supports `linux/amd64`, so both published runtime metadata records should stay pinned to that platform even if local dev builds support more than one architecture
