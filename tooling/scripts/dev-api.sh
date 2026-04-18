#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
api_port="${SELFHOST_API_PORT:-8788}"

bash "$root_dir/tooling/scripts/ensure-port-free.sh" \
  "$api_port" \
  "selfhost api" \
  "Stop the existing process or set SELFHOST_API_PORT to another port."

cd "$root_dir"
bun run --cwd apps/api dev
