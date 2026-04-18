#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
probe_port="${SELFHOST_PROBE_PORT:-8080}"

cd "$root_dir"

bash "$root_dir/tooling/scripts/ensure-port-free.sh" \
  "$probe_port" \
  "selfhost probe" \
  "Stop the existing process or set SELFHOST_PROBE_PORT to another port."

if [[ -z "${PROBE_LISTEN_ADDR:-}" ]]; then
  export PROBE_LISTEN_ADDR="0.0.0.0:${probe_port}"
fi

cargo run -p probe-server --manifest-path apps/probe-rs/Cargo.toml
