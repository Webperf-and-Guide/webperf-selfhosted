# Release assets

Tagged `v0.x.y` releases are created only by `.github/workflows/release.yml`
after the reusable CI workflow succeeds and the protected `release` GitHub
Environment authorizes publication.

Each release contains:

- six GHCR images tagged with the release version and source SHA;
- OCI-native SBOM and max-mode provenance attestations;
- GitHub provenance and SPDX SBOM attestations bound to each image digest;
- a tarball whose `compose.yml` pins all six image repositories by digest;
- `runtime-metadata.json` following `runtime-metadata.schema.json`;
- one SPDX JSON SBOM per image and SHA-256 checksums.

The managed cloud repository should consume `runtime-metadata.json` from a
specific GitHub Release. It must not infer runtime identity from `main`,
`latest`, or a mutable tag.

Before creating a release tag, apply and commit all pending Sampo changesets.
The workflow rejects tags outside `main` history and repositories with pending
changeset Markdown files.

Repository administrators must configure the `release` Environment with a
required reviewer and tag-only deployment rules. The workflow places this
single approval before any versioned image is pushed.
