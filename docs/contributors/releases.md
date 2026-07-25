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
`CHANGELOG.md` entry. Package `minor` and `major` changes both advance the
repository minor while WebPerf remains in public beta; an all-patch set advances
the repository patch. The generated changelog entry carries a hidden changeset
fingerprint so an interrupted local preparation can safely finish or rerun
without advancing twice. It synchronizes the lockfile, then creates or refreshes
one release PR. Feature PRs do not consume their own changesets. Because GitHub
suppresses ordinary workflow events caused by its built-in token, the
preparation workflow ensures Required CI runs against the generated branch. A
manual retry reuses a successful or still-running check for the same commit and
dispatches a fresh run only when the previous check failed, was cancelled, or
never started.

Review the generated repository version, root changelog, package versions, and
package changelogs, and merge only after Required CI passes. When that PR
reaches `main`, the same workflow resolves root `VERSION`. If `v<version>` does
not exist, it dispatches the protected formal release pinned to that exact merge
commit.

The release-preparation workflow never runs `sampo publish`; npm publication is
a separate future concern. Sampo remains the version/changelog source, while
the WebPerf release workflow owns the repository tag, GHCR images, and install
bundle.

## Approve and publish

The dispatched release validates that:

- every changeset was consumed;
- the requested version matches root `VERSION`;
- the checked-out source exactly matches the prepared commit;
- the source commit belongs to `main`; and
- an existing `v<version>` tag, if present, points to that exact commit.

It then runs Required CI and waits on the protected `release` GitHub
Environment. The environment must require a reviewer and allow only the `main`
branch for workflow dispatches plus `v*.*.*` tags. After approval, the workflow
creates or verifies the immutable repository tag before publishing anything.

For recovery or an intentionally manual release, dispatch the same idempotent
workflow:

```sh
gh workflow run release.yml --ref main \
  -f version=0.x.y \
  -f source_sha="$(git rev-parse origin/main)"
```

A manually pushed `v0.x.y` tag remains supported and enters the same validation,
approval, image, and bundle jobs.

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
   Release.

Formal install material never uses `main` or `latest`. The `main` and
`sha-<commit>` image tags are development channels published only after main
CI succeeds.

See [runtime images](../quickstart/runtime-images.md) and the machine-readable
[release contract](../../infra/release/README.md).
