#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
probe_port="${SELFHOST_PROBE_PORT:-}"

cd "$root_dir"

if [[ -n "$probe_port" && -z "${PROBE_LISTEN_ADDR:-}" ]]; then
  export PROBE_LISTEN_ADDR="0.0.0.0:${probe_port}"
fi

cargo run -p probe-server --manifest-path apps/probe-rs/Cargo.toml
