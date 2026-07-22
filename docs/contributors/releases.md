# Contributor release guide

Sampo changesets are the authoring source for public JS/TS package versions and
release notes. Repository releases use a protected `v0.x.y` tag, all six GHCR
images, and a digest-pinned Compose bundle.

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

## Prepare a tag

After the release PR is approved and required CI passes:

```sh
bun run sampo:release:dry-run
bun run sampo:release
bun run check
bun test
```

Commit the generated versions, changelog, and consumed changesets. The
repository tag must match the highest Sampo-managed `@webperf/*` package
version. The tag workflow rejects pending changesets, a version mismatch, or a
commit outside `main` history.

Repository administrators must configure a protected `release` GitHub
Environment with a required reviewer and tag-only deployment rules.

```sh
git tag v0.x.y
git push origin main v0.x.y
```

## Automated release gates

The tag workflow calls the reusable required CI workflow before the protected
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
