# Contributor release guide

Sampo changesets are the authoring source for public JS/TS package versions and
release notes. The root `VERSION` advances independently for whole-repository
releases, which use a protected `v0.x.y` tag, all six GHCR images, and a
digest-pinned Compose bundle.

## Add release metadata

Every user-visible change includes a file under `.sampo/changesets/` in the
same PR:

```sh
bun run sampo:add
bun run sampo:release:dry-run
```

Select only affected public packages and describe operator-visible behavior,
migration requirements, or contract changes. Do not use changesets to smuggle
managed-cloud behavior into the OSS release.

## Release PR automation

Every push to `main` that carries pending changesets starts
[`release-pr.yml`](../../.github/workflows/release-pr.yml). It uses the exact
Sampo version locked in `bun.lock` to consume all pending changesets on the
`release/sampo` branch. Before Sampo consumes them, the workflow uses their
largest bump to advance root `VERSION` and generate a matching root
`CHANGELOG.md` entry, and keeps the source Compose `WEBPERF_VERSION` aligned.
Package `minor` and `major` changes both advance the repository minor while
WebPerf remains in public beta; an all-patch set advances the repository patch.
The generated changelog entry carries a hidden changeset fingerprint so an
interrupted local preparation can safely finish or rerun without advancing
twice. It synchronizes the lockfile, then creates or refreshes one release PR.
Feature PRs do not consume their own changesets. Because GitHub
suppresses ordinary workflow events caused by its built-in token, the
preparation workflow ensures Required CI runs against the generated branch. A
manual retry reuses a successful or still-running check for the same commit and
dispatches a fresh run only when the previous check failed, was cancelled, or
never started.

Before it prepares any newer changesets, every surviving workflow run
reconciles the current root version. It resolves the exact commit where
`VERSION` last changed on main's first-parent history and dispatches that source
when its tag and an active matching release run are both absent. This makes
GitHub concurrency coalescing safe: a later main event can replace a queued
event without losing the already prepared repository release.

Review the generated repository version, root changelog, package versions, and
package changelogs, and merge only after Required CI passes. When that PR
reaches `main`, the same workflow resolves root `VERSION`. If `v<version>` does
not exist, it dispatches the protected formal release pinned to the main commit
that changed that version.

The release-preparation workflow never runs `sampo publish`; npm publication is
a separate future concern. Sampo remains the version/changelog source, while
the WebPerf release workflow owns the repository tag, GHCR images, and install
bundle.

## Approve and publish

The dispatched release validates that:

- every changeset was consumed;
- the requested version matches root `VERSION`;
- the checked-out source exactly matches the prepared commit;
- the source commit changed `VERSION` on main's first-parent history; and
- an existing `v<version>` tag, if present, points to that exact commit.

It then runs Required CI and waits on the protected `release` GitHub
Environment. The environment must require a reviewer and allow only the `main`
branch for workflow dispatches plus `v*.*.*` tags. After approval, the workflow
creates or verifies the immutable repository tag before publishing anything.

For recovery or an intentionally manual release, dispatch the same idempotent
workflow:

```sh
git fetch origin main
source_sha="$(git rev-list --first-parent -1 origin/main -- VERSION)"
version="$(git show "${source_sha}:VERSION")"
gh workflow run release.yml --ref main \
  -f version="$version" \
  -f source_sha="$source_sha"
```

Alternatively, a manually pushed tag remains supported, but it must be an
annotated tag at that same prepared source:

```sh
git tag -a "v${version}" "$source_sha" -m "WebPerf ${version}"
git push origin "refs/tags/v${version}"
```

That tag enters the same validation, approval, image, and bundle jobs. A
lightweight `git tag v0.x.y` is rejected.

## Automated release gates

The release workflow calls the reusable required CI workflow before the protected
environment approval. After approval it:

1. builds and publishes console, API, scheduler, executor, probe, and the
   Lighthouse reference runner for Linux/amd64;
2. tags each image with the version and source SHA;
3. emits OCI SBOM/provenance plus GitHub digest-bound attestations;
4. generates same-commit runtime metadata and standalone SPDX JSON SBOMs;
5. rewrites every release Compose image to an approved `@sha256:` reference;
6. creates a deterministic archive and SHA-256 checksum;
7. uploads the bundle, Compose file, runtime metadata, and SBOMs to the GitHub
   Release; and
8. downloads that public archive into fresh GitHub-hosted runners, verifies its
   checksum, and starts both the default and Browser Audit profiles with an
   empty Docker credential directory so the release is proven installable by an
   anonymous consumer.

Formal install material never uses `main` or `latest`. The `main` and
`sha-<commit>` image tags are development channels published only after main
CI succeeds.

See [runtime images](../quickstart/runtime-images.md) and the machine-readable
[release contract](../../infra/release/README.md).
