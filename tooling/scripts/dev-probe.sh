#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/../.."
exec cargo run -p probe-server --manifest-path apps/probe-rs/Cargo.toml
