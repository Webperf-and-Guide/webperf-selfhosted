# Release assets

Tagged `v0.x.y` releases are created only by `.github/workflows/release.yml`
after the reusable CI workflow succeeds and the protected `release` GitHub
Environment authorizes publication. `.github/workflows/release-pr.yml`
consumes pending Sampo changesets in a generated PR and dispatches that formal
workflow after the release PR merges. Root `VERSION` is the independent
repository-release version; the preparation workflow advances it and generates
the corresponding root changelog entry from the pending changesets while
synchronizing the source Compose `WEBPERF_VERSION`.

Each release contains:

- three multi-platform (`linux/amd64` and `linux/arm64`) GHCR image indexes,
  tagged with the release version and source SHA;
- OCI-native SBOM and max-mode provenance attestations;
- GitHub provenance bound to each image index plus SPDX SBOM attestations bound
  to each amd64 and arm64 platform manifest;
- a tarball whose `compose.yml` pins all three image repositories by digest;
- the root `VERSION` released by the tag;
- the `browser-audit-seccomp.json` referenced by that Compose file;
- `runtime-metadata.json` following `runtime-metadata.schema.json`;
- two SPDX JSON SBOMs per image (one per Linux platform) and SHA-256 checksums.

The managed cloud repository should consume `runtime-metadata.json` from a
specific GitHub Release. It must not infer runtime identity from `main`,
`latest`, or a mutable tag.

Before creating a release tag, merge the generated Sampo release PR. The
workflow rejects tags outside `main` history, repositories with pending
changeset Markdown files, versions that differ from root `VERSION`, dispatches
whose checkout differs from the requested source commit, and existing tags that
point to a different commit. The source must be the main first-parent commit
that changed `VERSION`, and operator-pushed tags must be annotated.

Repository administrators must configure the `release` Environment with a
required reviewer and deployment rules limited to the `main` branch plus
`v*.*.*` tags. The workflow places this single approval before the immutable
tag or any versioned image is pushed.
