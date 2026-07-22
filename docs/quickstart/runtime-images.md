# Runtime images and releases

`webperf-selfhosted` builds the six Linux/amd64 image families used by the
self-hosted product:

- `ghcr.io/webperf-and-guide/webperf-console`
- `ghcr.io/webperf-and-guide/webperf-api`
- `ghcr.io/webperf-and-guide/webperf-scheduler`
- `ghcr.io/webperf-and-guide/webperf-executor`
- `ghcr.io/webperf-and-guide/webperf-probe`
- `ghcr.io/webperf-and-guide/webperf-browser-audit-lighthouse`

## Formal releases

A `v0.x.y` tag on a commit in `main` starts the
[release workflow](../../.github/workflows/release.yml). The workflow first
runs the same required CI used by pull requests. It then publishes all six
images with the version and source-SHA tags, generates SPDX SBOMs and
provenance attestations, and creates a GitHub Release.

The downloadable release bundle contains a `compose.yml` in which every image
is pinned by OCI digest. It also contains:

- `runtime-metadata.json`, with the version, source commit, image tags, and
  digests;
- one SPDX JSON SBOM per image;
- `SHA256SUMS`, `CHANGELOG.md`, `SECURITY.md`, and the license;
- a generated `.env.example` with no default secrets.

Official installation material never uses `:main` or `:latest`. A version tag
is convenient for discovery, while the release Compose file and managed-cloud
runtime handoff use the immutable digest recorded in the same release.

The metadata schema and bundle contract live under
[infra/release](../../infra/release/README.md). Managed consumers must fetch
`runtime-metadata.json` from a specific GitHub Release instead of reading a
mutable file from the default branch.

## Development channel

After required CI passes on `main`, the
[CI workflow](../../.github/workflows/ci.yml) publishes all six images as:

- `:main`
- `:sha-<commit>`

These tags are for integration and pre-release testing only. The project does
not publish a `:latest` channel.

## Creating a release

Sampo changesets are the source for JS/TS package versions and release notes.

```sh
bun run sampo:release:dry-run
bun run sampo:release
git add CHANGELOG.md packages .sampo/changesets
git commit -m "release: prepare 0.x.y"
git tag v0.x.y
git push origin main v0.x.y
```

Use the highest Sampo-managed `@webperf/*` package version as the repository
release version. The tag workflow refuses a tag with pending changesets, a tag
outside `main` history, or a version that does not match that highest package
version.

## Local image builds

Use `compose.dev.yml` to build all services from the current checkout, or build
an individual image directly. For example:

```sh
docker buildx build --platform linux/amd64 \
  -f apps/browser-audit-lighthouse/Dockerfile \
  -t webperf-browser-audit-lighthouse:dev .

docker buildx build --platform linux/amd64 \
  -f apps/probe-rs/Dockerfile \
  -t webperf-probe:dev apps/probe-rs
```

This repository remains the runtime and image source of truth. Managed
orchestration, provider rollout, billing, and fleet configuration remain in
`webperf.and.guide`.
