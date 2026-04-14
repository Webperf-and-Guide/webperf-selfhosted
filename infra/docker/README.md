# Docker notes

The probe image is the primary Docker artifact in the repo today.

- Use `docker buildx build --platform linux/amd64`.
- Publish tags to GHCR or Docker Hub.
- Use `ghcr.io/your-org/webperf-probe` as the canonical Rust image.
- Use region-scoped image overrides only when a canary needs a different tag.
