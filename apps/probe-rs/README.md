# probe-rs

Rust probe runtime for Bunny Magic Containers.

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

Build for Bunny Magic Containers with `linux/amd64`:

```sh
docker buildx build --platform linux/amd64 -t ghcr.io/your-org/webperf-probe:dev ./apps/probe-rs
```
