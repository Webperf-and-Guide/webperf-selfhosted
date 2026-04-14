# Docker notes

The runtime images in this repo are:

- `ghcr.io/your-org/webperf-probe`
- `ghcr.io/your-org/webperf-browser-audit-worker`

Recommended builds:

- `docker buildx build --platform linux/amd64 -f apps/probe-rs/Dockerfile .`
- `docker buildx build --platform linux/amd64 -f apps/browser-audit-worker/Dockerfile .`

Ownership rules:

- this repo is the source of truth for both runtime images
- `webperf.and.guide` consumes those images through `BUNNY_PROBE_IMAGE` and `BUNNY_BROWSER_AUDIT_IMAGE`
- managed orchestration stays in the cloud repo, but the reusable runtime sources and Dockerfiles stay here
