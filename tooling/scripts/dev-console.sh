#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
control_base_url="${SELFHOST_CONTROL_BASE_URL:-http://127.0.0.1:8788}"
console_port="${SELFHOST_CONSOLE_PORT:-5173}"

bash "$root_dir/tooling/scripts/ensure-port-free.sh" \
  "$console_port" \
  "selfhost console" \
  "Stop the existing process or set SELFHOST_CONSOLE_PORT to another port."

cd "$root_dir"
export CONTROL_BASE_URL="$control_base_url"

vite_args=(--port "$console_port" "$@")

bun run --cwd apps/console dev -- "${vite_args[@]}"
