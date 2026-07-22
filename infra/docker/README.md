# Docker notes

The runtime images in this repo are:

- `ghcr.io/webperf-and-guide/webperf-probe`
- `ghcr.io/webperf-and-guide/webperf-browser-audit-lighthouse`

Recommended builds:

- `docker buildx build --platform linux/amd64 -f apps/probe-rs/Dockerfile .`
- `docker buildx build --platform linux/amd64 -f apps/browser-audit-lighthouse/Dockerfile .`

Ownership rules:

- this repo is the source of truth for both runtime images
- managed consumers resolve the checked-in metadata records rather than duplicating runtime image defaults
- managed orchestration stays in the cloud repo, but the reusable runtime sources and Dockerfiles stay here
- published runtime metadata stays pinned to `linux/amd64` for broad container-host compatibility even if local development supports more architectures
