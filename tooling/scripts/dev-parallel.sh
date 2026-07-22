#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
console_port="${SELFHOST_PARALLEL_CONSOLE_PORT:-4174}"
probe_port="${SELFHOST_PARALLEL_PROBE_PORT:-8082}"
probe_base_url="${SELFHOST_PARALLEL_PROBE_BASE_URL:-http://127.0.0.1:${probe_port}}"
api_base_url="${SELFHOST_PARALLEL_CONTROL_BASE_URL:-http://127.0.0.1:8788}"

cd "$root_dir"

random_secret() {
  bun -e 'console.log(crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", ""))'
}

export SELFHOST_ADMIN_TOKEN="${SELFHOST_ADMIN_TOKEN:-$(random_secret)}"
export SELFHOST_INTERNAL_SECRET="${SELFHOST_INTERNAL_SECRET:-$(random_secret)}"
export PROBE_SHARED_SECRET="${PROBE_SHARED_SECRET:-$(random_secret)}"
export BROWSER_AUDIT_SHARED_SECRET="${BROWSER_AUDIT_SHARED_SECRET:-$(random_secret)}"

bash "$root_dir/tooling/scripts/ensure-port-free.sh" \
  "$console_port" \
  "selfhost parallel console" \
  "Stop the existing process or set SELFHOST_PARALLEL_CONSOLE_PORT to another port."
bash "$root_dir/tooling/scripts/ensure-port-free.sh" \
  "$probe_port" \
  "selfhost parallel probe" \
  "Stop the existing process or set SELFHOST_PARALLEL_PROBE_PORT to another port."

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
