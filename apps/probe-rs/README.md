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

Build the reusable `linux/amd64` image:

```sh
docker buildx build --platform linux/amd64 -t webperf-probe:dev ./apps/probe-rs
```
