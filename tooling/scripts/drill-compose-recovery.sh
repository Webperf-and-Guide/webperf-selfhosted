#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
compose_file="${WEBPERF_RECOVERY_COMPOSE_FILE:-$root_dir/infra/docker-compose/compose.yml}"
dev_compose_file="${WEBPERF_RECOVERY_DEV_COMPOSE_FILE:-$root_dir/infra/docker-compose/compose.dev.yml}"
apparmor_compose_file="${WEBPERF_RECOVERY_APPARMOR_COMPOSE_FILE:-$root_dir/infra/docker-compose/compose.apparmor.yml}"
env_template="${WEBPERF_RECOVERY_ENV_TEMPLATE:-$root_dir/infra/docker-compose/.env.example}"
use_dev_override="${WEBPERF_RECOVERY_USE_DEV_OVERRIDE:-true}"
docker_config="${WEBPERF_RECOVERY_DOCKER_CONFIG:-}"
compose_project="webperf-recovery-$$"
temp_root="$(mktemp -d)"
temp_env="$temp_root/runtime.env"
manifest_path="$temp_root/recovery-manifest.json"
backup_dir="$temp_root/backup"
backup_database_path="$backup_dir/webperf.sqlite"
backup_artifacts_path="$backup_dir/artifacts"
volume_name="${compose_project}_webperf-data"
backup_inside_volume="/data/recovery-drill-backup.sqlite"

if [[ "$use_dev_override" != 'true' && "$use_dev_override" != 'false' ]]; then
  printf 'WEBPERF_RECOVERY_USE_DEV_OVERRIDE must be true or false, got %q\n' "$use_dev_override" >&2
  exit 1
fi

for required_file in "$compose_file" "$env_template" "$apparmor_compose_file"; do
  if [[ ! -f "$required_file" ]]; then
    echo "Required Compose recovery file is missing: $required_file" >&2
    exit 1
  fi
done

compose_files=(-f "$compose_file")
if [[ "$use_dev_override" == 'true' ]]; then
  if [[ ! -f "$dev_compose_file" ]]; then
    echo "Required development Compose override is missing: $dev_compose_file" >&2
    exit 1
  fi
  compose_files+=(-f "$dev_compose_file")
fi

if docker info --format '{{range .SecurityOptions}}{{println .}}{{end}}' | grep -qx 'name=apparmor'; then
  compose_files+=(-f "$apparmor_compose_file")
fi

if [[ -n "$docker_config" ]]; then
  mkdir -p "$docker_config"
fi

compose() {
  local -a compose_env=()
  if [[ -n "$docker_config" ]]; then
    compose_env+=("DOCKER_CONFIG=$docker_config")
  fi
  env "${compose_env[@]+${compose_env[@]}}" docker compose \
    --project-name "$compose_project" \
    --env-file "$temp_env" \
    "${compose_files[@]}" \
    "$@"
}

cleanup() {
  if [[ "$compose_project" == webperf-recovery-* ]]; then
    compose --profile browser-audit --profile debug down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -rf "$temp_root"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

generate_secret() {
  local value
  value="$(openssl rand -base64 32 | tr -d '\r\n')"
  if [[ ${#value} -lt 32 ]]; then
    echo 'Failed to generate a sufficiently long recovery-drill secret' >&2
    exit 1
  fi
  printf '%s' "$value"
}

admin_token="$(generate_secret)" || exit 1
internal_secret="$(generate_secret)" || exit 1
probe_secret="$(generate_secret)" || exit 1
browser_audit_secret="$(generate_secret)" || exit 1

cp "$env_template" "$temp_env"
mkdir -m 700 "$backup_dir" "$backup_artifacts_path"

RECOVERY_ADMIN_TOKEN="$admin_token" \
RECOVERY_INTERNAL_SECRET="$internal_secret" \
RECOVERY_PROBE_SECRET="$probe_secret" \
RECOVERY_BROWSER_AUDIT_SECRET="$browser_audit_secret" \
python3 - "$temp_env" <<'PY'
import os
from pathlib import Path
import sys

env_path = Path(sys.argv[1])
values = {}
for raw in env_path.read_text().splitlines():
    if not raw or raw.lstrip().startswith('#') or '=' not in raw:
        continue
    key, value = raw.split('=', 1)
    values[key] = value

values['SELFHOST_ADMIN_TOKEN'] = os.environ['RECOVERY_ADMIN_TOKEN']
values['SELFHOST_ADMIN_TOKEN_NEXT'] = ''
values['SELFHOST_INTERNAL_SECRET'] = os.environ['RECOVERY_INTERNAL_SECRET']
values['SELFHOST_INTERNAL_SECRET_NEXT'] = ''
values['PROBE_SHARED_SECRET'] = os.environ['RECOVERY_PROBE_SECRET']
values['PROBE_SHARED_SECRET_NEXT'] = ''
values['BROWSER_AUDIT_SHARED_SECRET'] = os.environ['RECOVERY_BROWSER_AUDIT_SECRET']
values['BROWSER_AUDIT_SHARED_SECRET_NEXT'] = ''
values['SELFHOST_REGION_ID'] = 'recovery-drill'
values['SELFHOST_REGION_LABEL'] = 'Recovery drill'
values['SELFHOST_PROBE_BASE_URL'] = 'http://probe:8080'
values['SELFHOST_BROWSER_AUDIT_BASE_URL'] = 'http://browser-audit-lighthouse:8080'
values['SELFHOST_SCHEDULER_MODE'] = 'disabled'
values['CONSOLE_PUBLIC_PORT'] = '0'
values['SELFHOST_API_DEBUG_PORT'] = '0'
values['BROWSER_AUDIT_DEBUG_PORT'] = '0'
env_path.write_text(''.join(f'{key}={value}\n' for key, value in values.items()))
PY
chmod 600 "$temp_env"

wait_for_api_debug() {
  local mapping
  local port

  compose --profile browser-audit --profile debug up -d --build
  compose --profile debug up -d --no-deps api-debug
  mapping="$(compose --profile debug port api-debug 8789)"
  port="${mapping##*:}"
  if [[ ! "$port" =~ ^[0-9]+$ ]]; then
    echo "Unable to determine API debug proxy host port from ${mapping:-no mapping}" >&2
    exit 1
  fi
  api_debug_url="http://127.0.0.1:${port}"
  for _ in {1..90}; do
    if curl -fsS "${api_debug_url}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  compose --profile browser-audit --profile debug logs --no-color --tail 160 >&2 || true
  echo "API debug proxy failed to become ready at ${api_debug_url}" >&2
  exit 1
}

api_debug_url=""
wait_for_api_debug
bun "$root_dir/tooling/scripts/compose-recovery-fixture.ts" \
  seed "$api_debug_url" "$admin_token" "$manifest_path"

# Freeze every writer before copying SQLite and artifact bytes.
compose --profile browser-audit --profile debug stop
compose run --rm --no-deps --entrypoint bun api \
  /app/tooling/scripts/selfhost-database.ts backup \
  --database /data/webperf.sqlite \
  --output "$backup_inside_volume"
compose cp "api:${backup_inside_volume}" "$backup_database_path"
compose cp "api:/data/artifacts/." "$backup_artifacts_path/"
cp "$temp_env" "$backup_dir/webperf.env"
chmod 600 "$backup_database_path" "$backup_dir/webperf.env"
openssl dgst -sha256 -r "$backup_database_path" > "$backup_dir/webperf.sqlite.sha256"
compose run --rm --no-deps --entrypoint rm api -f "$backup_inside_volume"

# This is an intentionally destructive step against a uniquely named,
# process-owned test project. Production documentation continues to prohibit
# down -v during operator recovery.
if [[ "$compose_project" != webperf-recovery-* ]]; then
  echo "Refusing to delete a non-recovery Compose project: $compose_project" >&2
  exit 1
fi
compose --profile browser-audit --profile debug down -v --remove-orphans
if docker volume inspect "$volume_name" >/dev/null 2>&1; then
  echo "Expected isolated recovery volume to be deleted: $volume_name" >&2
  exit 1
fi
expected_database_sha256="$(awk 'NR == 1 { print $1 }' "$backup_dir/webperf.sqlite.sha256")"
actual_database_sha256="$(openssl dgst -sha256 -r "$backup_database_path" | awk 'NR == 1 { print $1 }')"
if [[ ! "$expected_database_sha256" =~ ^[0-9a-f]{64}$ ]] \
  || [[ "$actual_database_sha256" != "$expected_database_sha256" ]]; then
  echo "Recovery database checksum verification failed" >&2
  exit 1
fi

# Recreate an empty named volume, restore both halves of the recovery point as
# UID/GID 1000, then run the same guarded restore/migrate/doctor commands that
# operators use from the release bundle.
compose run -T --rm --no-deps --entrypoint sh api \
  -c 'umask 077; cat > /data/restore.sqlite' < "$backup_database_path"
tar -C "$backup_artifacts_path" -cf - . \
  | compose run -T --rm --no-deps --entrypoint sh api \
    -c 'set -eu; umask 077; mkdir -p /data/artifacts; tar -C /data/artifacts -xf -'
compose run --rm --no-deps --entrypoint bun api \
  /app/tooling/scripts/selfhost-database.ts restore \
  /data/restore.sqlite \
  --no-backup \
  --database /data/webperf.sqlite
compose run --rm --no-deps --entrypoint bun api \
  /app/tooling/scripts/selfhost-database.ts migrate \
  --database /data/webperf.sqlite \
  --backup
doctor_output="$(
  compose run --rm --no-deps --entrypoint bun api \
    /app/tooling/scripts/selfhost-database.ts doctor \
    --database /data/webperf.sqlite
)"
bun -e '
  const lines = process.argv[1].trim().split(/\r?\n/);
  const payload = JSON.parse(lines.at(-1));
  if (payload.ok !== true || payload.command !== "doctor") {
    throw new Error(`Recovery doctor failed: ${JSON.stringify(payload).slice(0, 2048)}`);
  }
' "$doctor_output"

wait_for_api_debug
bun "$root_dir/tooling/scripts/compose-recovery-fixture.ts" \
  verify "$api_debug_url" "$admin_token" "$manifest_path"

echo '{"ok":true,"drill":"compose-backup-restore","database":"verified","artifacts":"verified"}'
