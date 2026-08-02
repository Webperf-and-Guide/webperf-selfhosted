# Runtime images and releases

`webperf-selfhosted` builds the three Linux image families used by the
self-hosted product. Every published runtime reference is a multi-platform OCI
index for `linux/amd64` and `linux/arm64`:

- `ghcr.io/webperf-and-guide/webperf` — single multi-role Bun image covering
  console, API, scheduler, and executor. The default `standalone` role
  supervises console, API, and executor in one container with embedded
  scheduling. Its PID 1 supervisor holds only `SETUID`, `SETGID`, and `KILL`
  so it can run those services under distinct non-root UIDs; it does not open
  a network listener. The API and console can start while the separate probe is
  unavailable, but the supervisor waits for the probe health endpoint before
  starting the executor so queued work does not consume retries during a
  routine stack startup. Split `console`, `api`, `scheduler`, and `executor`
  roles remain available for development and maintenance through
  `tooling/scripts/webperf-role.ts`.
- `ghcr.io/webperf-and-guide/webperf-probe`
- `ghcr.io/webperf-and-guide/webperf-browser-audit-lighthouse`

## Formal releases

Merging a Sampo-generated release PR dispatches the
[release workflow](../../.github/workflows/release.yml) for the independent root
`VERSION` and exact release-PR merge commit. The workflow runs the same required
CI used by pull requests against that pinned source and waits for the protected
`release` GitHub Environment. Once approved, it creates or verifies the matching
`v0.x.y` repository tag, publishes images with version and source-SHA
tags, generates a distinct SPDX SBOM for each published amd64 and arm64
manifest, attests those SBOMs to their matching child digests, and creates a
GitHub Release. A manually pushed annotated `v0.x.y` tag enters the same
protected path.

The downloadable release bundle contains a `compose.yml` in which every image
is pinned by OCI digest. It also contains:

- `runtime-metadata.json`, with the version, source commit, image tags, and
  digests;
- root `VERSION`;
- two SPDX JSON SBOMs per image, one for each Linux platform;
- `browser-audit-seccomp.json`, kept beside `compose.yml` for the optional
  Chromium runtime;
- `SHA256SUMS`, `CHANGELOG.md`, `SECURITY.md`, and the license;
- a generated `.env.example` with no default secrets.

Official installation material never uses `:main` or `:latest`. A version tag
is convenient for discovery, while the release Compose file and the WebPerf &
Guide Managed use immutable image digests recorded in the same release.
Docker resolves that digest to the host's matching native platform manifest.
For compatibility, `images[].sbom` names the amd64 SBOM; releases that include
both platforms also expose `images[].sboms`, which maps each platform manifest
digest to its SBOM file.

Direct release-bundle upgrades are supported from `v0.4.0`, the first release
of the current consolidated topology. The earlier `webperf-console`,
`webperf-api`, `webperf-scheduler`, `webperf-executor`, and
`webperf-browser-audit-worker` packages are retired and are not needed by the
release gate. Versions newer than the baseline must prove a same-volume
`v0.4.0` upgrade before the formal release completes.

The metadata schema and bundle contract live under
[infra/release](../../infra/release/README.md). Managed consumers must fetch
`runtime-metadata.json` from a specific GitHub Release instead of reading a
mutable file from the default branch.

## Development channel

After required CI passes on `main`, the
[CI workflow](../../.github/workflows/ci.yml) publishes all three images as:

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
an individual image directly. Choose one of the two supported target platforms
for a local image load:

```sh
WEBPERF_PLATFORM=linux/arm64 # or linux/amd64

docker buildx build --platform "$WEBPERF_PLATFORM" --load \
  -f infra/docker/Dockerfile.webperf \
  -t webperf:dev .

docker buildx build --platform "$WEBPERF_PLATFORM" --load \
  -f apps/browser-audit-lighthouse/Dockerfile \
  -t webperf-browser-audit-lighthouse:dev .

docker buildx build --platform "$WEBPERF_PLATFORM" --load \
  -f apps/probe-rs/Dockerfile \
  -t webperf-probe:dev apps/probe-rs
```

This repository remains the runtime and image source of truth. Managed
orchestration, provider rollout, billing, and fleet configuration remain in
`webperf.and.guide`.
