#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
source "$root_dir/tooling/scripts/dev-secrets.sh"

cd "$root_dir"
bunx concurrently -n console,api,probe,scheduler \
  "bun run dev:console" \
  "bun run dev:api" \
  "bun run dev:probe" \
  "bun run dev:scheduler"
