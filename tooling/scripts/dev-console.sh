#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
config_path="$root_dir/apps/console/.dev.vars"
backup_path=""

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

cat >"$config_path" <<'EOF'
CONTROL_BASE_URL=http://127.0.0.1:8788
CONTROL_BINDING_MODE=disabled
DEPLOY_TARGET=pages
TURNSTILE_SITE_KEY=
EOF

cd "$root_dir"
bun run --cwd apps/console dev -- "$@"
