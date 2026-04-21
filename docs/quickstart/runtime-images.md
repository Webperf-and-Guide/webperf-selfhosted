# Runtime Images

`webperf-selfhosted` is the source of truth for reusable runtime images.

## Published Image Families

- `ghcr.io/webperf-and-guide/webperf-probe`
- `ghcr.io/webperf-and-guide/webperf-browser-audit-worker`

## Publish Trigger

Both image families publish through GitHub Actions in this repo.

- merges or direct pushes to `main` trigger the matching publish workflow
- `workflow_dispatch` remains available for manual republish
- the default-branch publish path keeps `:main`, `:latest`, and `:sha-...` tags aligned

Checked-in image refs live in:

- [probe.json](/Users/imjlk/repos/and-guide/webperf-selfhosted/infra/docker/metadata/probe.json)
- [browser-audit-worker.json](/Users/imjlk/repos/and-guide/webperf-selfhosted/infra/docker/metadata/browser-audit-worker.json)

The managed repo consumes these metadata files when it renders Bunny and Cloudflare runtime config.

Relevant workflows:

- [.github/workflows/publish-probe-image.yml](/Users/imjlk/repos/and-guide/webperf-selfhosted/.github/workflows/publish-probe-image.yml)
- [.github/workflows/publish-browser-audit-image.yml](/Users/imjlk/repos/and-guide/webperf-selfhosted/.github/workflows/publish-browser-audit-image.yml)

## Quick Pull

```bash
docker pull ghcr.io/webperf-and-guide/webperf-probe:main
docker pull ghcr.io/webperf-and-guide/webperf-browser-audit-worker:main
```

## Local Build

Probe:

```bash
docker build -f apps/probe-rs/Dockerfile -t webperf-probe:dev .
```

Browser audit worker:

```bash
docker build -f apps/browser-audit-worker/Dockerfile -t webperf-browser-audit-worker:dev .
```

## Policy

- GHCR images are the deployment artifact boundary.
- This repo remains the runtime/image source of truth.
- `webperf.and.guide` consumes these images and adds managed rollout/orchestration around them.
- Package publishing is not part of the launch path. The launch baseline is repo source plus GHCR images.
