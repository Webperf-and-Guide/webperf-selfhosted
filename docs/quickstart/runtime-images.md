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

Merging a Sampo-generated release PR dispatches the
[release workflow](../../.github/workflows/release.yml) for the independent root
`VERSION` and exact release-PR merge commit. The workflow runs the same required
CI used by pull requests against that pinned source and waits for the protected
`release` GitHub Environment. Once approved, it creates or verifies the matching
`v0.x.y` repository tag, publishes all six images with version and source-SHA
tags, generates SPDX SBOMs and provenance attestations, and creates a GitHub
Release. A manually pushed annotated `v0.x.y` tag enters the same protected
path.

The downloadable release bundle contains a `compose.yml` in which every image
is pinned by OCI digest. It also contains:

- `runtime-metadata.json`, with the version, source commit, image tags, and
  digests;
- root `VERSION`;
- one SPDX JSON SBOM per image;
- `browser-audit-seccomp.json`, kept beside `compose.yml` for the optional
  Chromium runtime;
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
Feature PRs add changesets but do not consume them. After those PRs merge,
[`release-pr.yml`](../../.github/workflows/release-pr.yml) creates or refreshes
`release/sampo` with generated package versions and changelogs plus an
independently advanced root `VERSION`, matching root changelog entry, and
synchronized source Compose image version. Before preparing newer changesets,
each run reconciles any untagged current repository version from the exact main
first-parent commit where `VERSION` changed, so coalesced workflow events do not
drop a release.

```sh
gh pr view --repo Webperf-and-Guide/webperf-selfhosted
# Review and merge the generated release/sampo PR after Required CI.
# Approve the waiting `release` Environment deployment.
```

The release PR merge automatically dispatches the formal workflow when the
matching tag is absent. To retry safely:

```sh
git fetch origin main
source_sha="$(git rev-list --first-parent -1 origin/main -- VERSION)"
version="$(git show "${source_sha}:VERSION")"
gh workflow run release.yml --ref main \
  -f version="$version" \
  -f source_sha="$source_sha"
```

The workflow refuses pending changesets, a source outside `main` history, a
version that does not match root `VERSION`, a checkout that does not match the
requested source commit, a source that did not change `VERSION` on main's
first-parent history, or an existing tag that points elsewhere. A manually
pushed tag must be annotated:

```sh
git tag -a "v${version}" "$source_sha" -m "WebPerf ${version}"
git push origin "refs/tags/v${version}"
```

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
