#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/../.."
bun run check
cargo clippy --workspace --all-targets --manifest-path apps/probe-rs/Cargo.toml -- -D warnings
cargo test --workspace --manifest-path apps/probe-rs/Cargo.toml
