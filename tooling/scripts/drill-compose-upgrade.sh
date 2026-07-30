#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
legacy_compose_file="${WEBPERF_UPGRADE_LEGACY_COMPOSE_FILE:?set WEBPERF_UPGRADE_LEGACY_COMPOSE_FILE}"
legacy_env_template="${WEBPERF_UPGRADE_LEGACY_ENV_TEMPLATE:?set WEBPERF_UPGRADE_LEGACY_ENV_TEMPLATE}"
legacy_version="${WEBPERF_UPGRADE_LEGACY_VERSION:?set WEBPERF_UPGRADE_LEGACY_VERSION}"
current_compose_file="${WEBPERF_UPGRADE_CURRENT_COMPOSE_FILE:-$root_dir/infra/docker-compose/compose.yml}"
current_dev_compose_file="${WEBPERF_UPGRADE_CURRENT_DEV_COMPOSE_FILE:-$root_dir/infra/docker-compose/compose.dev.yml}"
current_env_template="${WEBPERF_UPGRADE_CURRENT_ENV_TEMPLATE:-$root_dir/infra/docker-compose/.env.example}"
use_current_dev_override="${WEBPERF_UPGRADE_USE_CURRENT_DEV_OVERRIDE:-true}"
docker_config="${WEBPERF_UPGRADE_DOCKER_CONFIG:-}"
compose_project="webperf-upgrade-$$"
temp_root="$(mktemp -d)"

cleanup() {
  if \
    [[ "$compose_project" == webperf-upgrade-* ]] \
    && declare -F bounded_compose_down >/dev/null \
    && declare -F current >/dev/null \
    && declare -F legacy >/dev/null; then
    bounded_compose_down current >/dev/null 2>&1 || true
    bounded_compose_down legacy >/dev/null 2>&1 || true
  fi
  rm -rf "$temp_root"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

legacy_env="$temp_root/legacy.env"
current_env="$temp_root/current.env"
manifest_path="$temp_root/upgrade-manifest.json"
volume_name="${compose_project}_webperf-data"

for required_binary in bun curl docker openssl python3 tr; do
  if ! command -v "$required_binary" >/dev/null 2>&1; then
    echo "Required Compose upgrade command is unavailable: $required_binary" >&2
    exit 1
  fi
done

if [[ "$use_current_dev_override" != 'true' && "$use_current_dev_override" != 'false' ]]; then
  printf 'WEBPERF_UPGRADE_USE_CURRENT_DEV_OVERRIDE must be true or false, got %q\n' \
    "$use_current_dev_override" >&2
  exit 1
fi

for required_file in \
  "$legacy_compose_file" \
  "$legacy_env_template" \
  "$current_compose_file" \
  "$current_env_template"; do
  if [[ ! -f "$required_file" ]]; then
    echo "Required Compose upgrade file is missing: $required_file" >&2
    exit 1
  fi
done
if [[ "$use_current_dev_override" == 'true' && ! -f "$current_dev_compose_file" ]]; then
  echo "Required current development Compose override is missing: $current_dev_compose_file" >&2
  exit 1
fi

if [[ -n "$docker_config" ]]; then
  mkdir -p "$docker_config"
fi

compose_with() {
  local env_file="$1"
  shift
  local -a compose_env=()
  if [[ -n "$docker_config" ]]; then
    compose_env+=("DOCKER_CONFIG=$docker_config")
  fi
  env "${compose_env[@]+${compose_env[@]}}" docker compose \
    --project-name "$compose_project" \
    --env-file "$env_file" \
    "$@"
}

legacy() {
  compose_with "$legacy_env" -f "$legacy_compose_file" "$@"
}

current() {
  local -a files=(-f "$current_compose_file")
  if [[ "$use_current_dev_override" == 'true' ]]; then
    files+=(-f "$current_dev_compose_file")
  fi
  compose_with "$current_env" "${files[@]}" "$@"
}

bounded_compose_down() {
  local runner="$1"
  local down_pid
  local watchdog_pid
  local watchdog_stop
  local status

  "$runner" --profile debug down -v --remove-orphans --timeout 30 &
  down_pid=$!
  watchdog_stop="$temp_root/compose-down-${runner}-${down_pid}.stop"
  (
    for _ in {1..60}; do
      if [[ -e "$watchdog_stop" ]]; then
        exit 0
      fi
      sleep 1
    done
    if kill -0 "$down_pid" >/dev/null 2>&1; then
      kill -TERM "$down_pid" >/dev/null 2>&1 || true
      sleep 5
      kill -KILL "$down_pid" >/dev/null 2>&1 || true
    fi
  ) &
  watchdog_pid=$!

  if wait "$down_pid"; then
    status=0
  else
    status=$?
  fi
  : > "$watchdog_stop"
  wait "$watchdog_pid" >/dev/null 2>&1 || true
  rm -f "$watchdog_stop"
  return "$status"
}

generate_secret() {
  local value
  value="$(openssl rand -base64 32 | tr -d '\r\n')"
  if [[ ${#value} -lt 32 ]]; then
    echo 'Failed to generate a sufficiently long upgrade-drill secret' >&2
    exit 1
  fi
  printf '%s' "$value"
}

admin_token="$(generate_secret)"
internal_secret="$(generate_secret)"
probe_secret="$(generate_secret)"
browser_audit_secret="$(generate_secret)"

cp "$legacy_env_template" "$legacy_env"
cp "$current_env_template" "$current_env"
UPGRADE_ADMIN_TOKEN="$admin_token" \
UPGRADE_INTERNAL_SECRET="$internal_secret" \
UPGRADE_PROBE_SECRET="$probe_secret" \
UPGRADE_BROWSER_AUDIT_SECRET="$browser_audit_secret" \
python3 - "$legacy_env" "$current_env" <<'PY'
import os
from pathlib import Path
import sys

def read_env(path: Path):
    values = {}
    for raw in path.read_text().splitlines():
        if not raw or raw.lstrip().startswith('#') or '=' not in raw:
            continue
        key, value = raw.split('=', 1)
        values[key] = value
    return values

def write_env(path: Path, values):
    path.write_text(''.join(f'{key}={value}\n' for key, value in values.items()))

legacy_path = Path(sys.argv[1])
current_path = Path(sys.argv[2])
shared = {
    'SELFHOST_ADMIN_TOKEN': os.environ['UPGRADE_ADMIN_TOKEN'],
    'SELFHOST_ADMIN_TOKEN_NEXT': '',
    'SELFHOST_INTERNAL_SECRET': os.environ['UPGRADE_INTERNAL_SECRET'],
    'SELFHOST_INTERNAL_SECRET_NEXT': '',
    'PROBE_SHARED_SECRET': os.environ['UPGRADE_PROBE_SECRET'],
    'PROBE_SHARED_SECRET_NEXT': '',
    'BROWSER_AUDIT_SHARED_SECRET': os.environ['UPGRADE_BROWSER_AUDIT_SECRET'],
    'BROWSER_AUDIT_SHARED_SECRET_NEXT': '',
    'CONSOLE_PUBLIC_PORT': '0',
    'SELFHOST_API_DEBUG_PORT': '0',
    'BROWSER_AUDIT_DEBUG_PORT': '0',
}

legacy = read_env(legacy_path)
legacy.update(shared)
legacy.update({
    'SELFHOST_ACTIVE_REGION_CODES_JSON': '["tokyo","singapore"]',
    'SELFHOST_REGION_IDS_JSON': '{"tokyo":"JP","singapore":"SG"}',
    'SELFHOST_PROBE_BASE_URLS_JSON': '{"tokyo":"http://probe:8080","singapore":"http://probe:8080"}',
    'SELFHOST_SCHEDULER_POLL_INTERVAL_SECONDS': '3600',
    'SELFHOST_MIGRATION_BACKUP': 'false',
})
write_env(legacy_path, legacy)

current = read_env(current_path)
current.update(shared)
current.update({
    'SELFHOST_REGION_ID': 'tokyo',
    'SELFHOST_REGION_LABEL': 'Tokyo upgrade runtime',
    'SELFHOST_PROBE_BASE_URL': 'http://probe:8080',
    'SELFHOST_SCHEDULER_MODE': 'disabled',
    'SELFHOST_MIGRATION_BACKUP': 'true',
})
write_env(current_path, current)
PY
chmod 600 "$legacy_env" "$current_env"

wait_for_api_debug() {
  local runner="$1"
  local runtime_service="$2"
  local mapping
  local port
  local base_url

  "$runner" --profile debug up -d "$runtime_service" api-debug
  mapping="$("$runner" --profile debug port api-debug 8789)"
  port="${mapping##*:}"
  if [[ ! "$port" =~ ^[0-9]+$ ]]; then
    echo "Unable to determine $runner API debug proxy host port from ${mapping:-no mapping}" >&2
    exit 1
  fi
  base_url="http://127.0.0.1:${port}"
  for _ in {1..120}; do
    if curl -fsS "${base_url}/health" >/dev/null 2>&1; then
      printf '%s' "$base_url"
      return 0
    fi
    sleep 1
  done
  "$runner" --profile debug logs --no-color --tail 200 >&2 || true
  echo "$runner API debug proxy failed to become ready at $base_url" >&2
  exit 1
}

legacy_base_url="$(wait_for_api_debug legacy api)"
WEBPERF_UPGRADE_ADMIN_TOKEN="$admin_token" \
  bun "$root_dir/tooling/scripts/compose-upgrade-fixture.ts" \
    seed-legacy "$legacy_base_url" "$manifest_path"

# Stop every legacy writer, retain the named data volume, and replace only the
# runtime topology. This models an operator following the release upgrade path.
legacy --profile debug stop api-debug api
legacy_down_status=0
legacy --profile debug down --remove-orphans --timeout 30 || legacy_down_status=$?
if ! docker volume inspect "$volume_name" >/dev/null 2>&1; then
  echo "Legacy data volume disappeared during the non-destructive upgrade: $volume_name" >&2
  exit 1
fi
if (( legacy_down_status != 0 )); then
  echo "Legacy Compose teardown failed with status $legacy_down_status" >&2
  exit "$legacy_down_status"
fi

if [[ "$use_current_dev_override" == 'true' ]]; then
  current --profile debug build webperf
fi
current_base_url="$(wait_for_api_debug current webperf)"

current run --rm --no-deps --entrypoint sh webperf -c \
  'set -- /data/webperf.sqlite.backup-*; test -f "$1"'
doctor_output_path="$temp_root/doctor-output.log"
current run --rm --no-deps --entrypoint bun webperf \
  /app/tooling/scripts/selfhost-database.ts doctor \
  --database /data/webperf.sqlite > "$doctor_output_path"
bun -e '
  const fail = (message) => {
    throw new Error(`Upgraded database doctor verification failed: ${message}`);
  };
  let payload;
  try {
    payload = JSON.parse(await Bun.file(process.argv[1]).text());
  } catch (error) {
    const detail = error instanceof Error
      ? error.message.slice(0, 256)
      : "non-Error parse failure";
    fail(`doctor output was not valid JSON: ${detail}`);
  }
  if (payload?.ok !== true) fail("ok is not true");
  if (payload?.command !== "doctor") fail("command is not doctor");
  if (payload?.integrity?.ok !== true) fail("integrity.ok is not true");
  if (payload?.integrity?.foreignKeyViolations !== 0) {
    fail(`foreign key violations: ${payload?.integrity?.foreignKeyViolations ?? "missing"}`);
  }
  if (!Array.isArray(payload?.migrations?.pending)) {
    fail("migrations.pending is not an array");
  }
  if (payload.migrations.pending.length !== 0) {
    fail(`pending migrations: ${payload.migrations.pending.length}`);
  }
  if (!Array.isArray(payload?.migrations?.unknown)) {
    fail("migrations.unknown is not an array");
  }
  if (payload.migrations.unknown.length !== 0) {
    fail(`unknown migrations: ${payload.migrations.unknown.length}`);
  }
' "$doctor_output_path"
WEBPERF_UPGRADE_ADMIN_TOKEN="$admin_token" \
  bun "$root_dir/tooling/scripts/compose-upgrade-fixture.ts" \
    verify-current "$current_base_url" "$manifest_path"

printf '{"ok":true,"drill":"compose-version-upgrade","from":"%s","storedData":"verified"}\n' \
  "$legacy_version"
