# Release assets

Tagged `v0.x.y` releases are created only by `.github/workflows/release.yml`
after the reusable CI workflow succeeds and the protected `release` GitHub
Environment authorizes publication. `.github/workflows/release-pr.yml`
consumes pending Sampo changesets in a generated PR and dispatches that formal
workflow after the release PR merges.

Each release contains:

- six GHCR images tagged with the release version and source SHA;
- OCI-native SBOM and max-mode provenance attestations;
- GitHub provenance and SPDX SBOM attestations bound to each image digest;
- a tarball whose `compose.yml` pins all six image repositories by digest;
- the `browser-audit-seccomp.json` referenced by that Compose file;
- `runtime-metadata.json` following `runtime-metadata.schema.json`;
- one SPDX JSON SBOM per image and SHA-256 checksums.

The managed cloud repository should consume `runtime-metadata.json` from a
specific GitHub Release. It must not infer runtime identity from `main`,
`latest`, or a mutable tag.

Before creating a release tag, merge the generated Sampo release PR. The
workflow rejects tags outside `main` history, repositories with pending
changeset Markdown files, version mismatches, and existing tags that point to a
different commit.

Repository administrators must configure the `release` Environment with a
required reviewer and deployment rules limited to the `main` branch plus
`v*.*.*` tags. The workflow places this single approval before the immutable
tag or any versioned image is pushed.
