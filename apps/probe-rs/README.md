# probe-rs

Rust network probe runtime for self-hosted WebPerf.

## Local run

```sh
cargo run -p probe-server --manifest-path apps/probe-rs/Cargo.toml
```

## Tests

```sh
cargo test --workspace --manifest-path apps/probe-rs/Cargo.toml
cargo clippy --workspace --all-targets --manifest-path apps/probe-rs/Cargo.toml -- -D warnings
```

## Docker build

Build a reusable image for either supported Linux architecture:

```sh
WEBPERF_PLATFORM=linux/arm64 # or linux/amd64
docker buildx build --platform "$WEBPERF_PLATFORM" --load \
  -t webperf-probe:dev ./apps/probe-rs
```
