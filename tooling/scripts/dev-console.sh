#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
config_path="$root_dir/apps/console/.dev.vars"
backup_path=""
control_base_url="${SELFHOST_CONTROL_BASE_URL:-http://127.0.0.1:8788}"
console_port="${SELFHOST_CONSOLE_PORT:-}"

restore_config() {
  if [[ -n "$backup_path" && -f "$backup_path" ]]; then
    mv "$backup_path" "$config_path"
  else
    rm -f "$config_path"
  fi
}

if [[ -f "$config_path" ]]; then
  backup_path="$(mktemp "${TMPDIR:-/tmp}/webperf-console-devvars.XXXXXX")"
  cp "$config_path" "$backup_path"
fi

trap restore_config EXIT INT TERM

cat >"$config_path" <<EOF
CONTROL_BASE_URL=$control_base_url
DEPLOY_TARGET=pages
TURNSTILE_SITE_KEY=
EOF

cd "$root_dir"
export CONTROL_BASE_URL="$control_base_url"
export DEPLOY_TARGET="pages"
export TURNSTILE_SITE_KEY=""
export WEBPERF_CONSOLE_ADAPTER=node

vite_args=("$@")

if [[ -n "$console_port" ]]; then
  vite_args=(--port "$console_port" "${vite_args[@]}")
fi

bun run --cwd apps/console dev -- "${vite_args[@]}"
