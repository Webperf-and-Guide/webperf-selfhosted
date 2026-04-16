#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
console_port="${SELFHOST_PARALLEL_CONSOLE_PORT:-4174}"
probe_port="${SELFHOST_PARALLEL_PROBE_PORT:-8082}"
probe_base_url="${SELFHOST_PARALLEL_PROBE_BASE_URL:-http://127.0.0.1:${probe_port}}"
api_base_url="${SELFHOST_PARALLEL_CONTROL_BASE_URL:-http://127.0.0.1:8788}"

cd "$root_dir"

if [[ -n "${SELFHOST_PARALLEL_PROBE_BASE_URLS_JSON:-}" ]]; then
  export SELFHOST_PROBE_BASE_URLS_JSON="$SELFHOST_PARALLEL_PROBE_BASE_URLS_JSON"
else
  printf -v SELFHOST_PROBE_BASE_URLS_JSON '{"tokyo":"%s"}' "$probe_base_url"
  export SELFHOST_PROBE_BASE_URLS_JSON
fi
export SELFHOST_CONTROL_BASE_URL="$api_base_url"
export SELFHOST_CONSOLE_PORT="$console_port"
export SELFHOST_PROBE_PORT="$probe_port"

bunx concurrently -n console,api,probe,scheduler \
  "bun run dev:console" \
  "bun run dev:api" \
  "bun run dev:probe" \
  "bun run dev:scheduler"
