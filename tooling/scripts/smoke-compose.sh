#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
compose_file="${WEBPERF_SMOKE_COMPOSE_FILE:-$root_dir/infra/docker-compose/compose.yml}"
dev_compose_file="${WEBPERF_SMOKE_DEV_COMPOSE_FILE:-$root_dir/infra/docker-compose/compose.dev.yml}"
apparmor_compose_file="${WEBPERF_SMOKE_APPARMOR_COMPOSE_FILE:-$root_dir/infra/docker-compose/compose.apparmor.yml}"
env_template="${WEBPERF_SMOKE_ENV_TEMPLATE:-$root_dir/infra/docker-compose/.env.example}"
use_dev_override="${WEBPERF_SMOKE_USE_DEV_OVERRIDE:-true}"
docker_config="${WEBPERF_SMOKE_DOCKER_CONFIG:-}"
compose_project="webperf-smoke-$$"
profile="${COMPOSE_PROFILE:-default}"
temp_env="$(mktemp)"
temp_artifact="$(mktemp)"

if [[ "$use_dev_override" != 'true' && "$use_dev_override" != 'false' ]]; then
  printf 'WEBPERF_SMOKE_USE_DEV_OVERRIDE must be true or false, got %q\n' "$use_dev_override" >&2
  exit 1
fi

for required_file in "$compose_file" "$env_template"; do
  if [[ ! -f "$required_file" ]]; then
    echo "Required Compose smoke file is missing: $required_file" >&2
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

if [[ "$profile" == "browser-audit" ]] && docker info --format '{{range .SecurityOptions}}{{println .}}{{end}}' | grep -qx 'name=apparmor'; then
  if [[ ! -f "$apparmor_compose_file" ]]; then
    echo "Required Browser Audit AppArmor Compose overlay is missing: $apparmor_compose_file" >&2
    exit 1
  fi
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

assert_service_unpublished() {
  local service="$1"
  local label="$2"
  shift 2
  local -a profile_flags=("$@")
  local container_id
  local published_bindings

  container_id="$(compose "${profile_flags[@]}" ps -q "$service")"
  if [[ -z "$container_id" ]]; then
    echo "Expected ${label} container to exist" >&2
    exit 1
  fi

  published_bindings="$(
    docker inspect \
      --format '{{range $port, $bindings := .HostConfig.PortBindings}}{{if $bindings}}{{$port}}={{json $bindings}} {{end}}{{end}}' \
      "$container_id"
  )"
  if [[ -n "$published_bindings" ]]; then
    echo "Expected ${label} to stay unpublished, got ${published_bindings}" >&2
    exit 1
  fi
}

host_port_from_mapping() {
  local mapping="$1"
  local label="$2"
  local port="${mapping##*:}"

  if [[ ! "$port" =~ ^[0-9]+$ ]]; then
    echo "Unable to determine ${label} host port from ${mapping:-no mapping}" >&2
    exit 1
  fi

  echo "$port"
}

cleanup() {
  compose --profile browser-audit --profile debug down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$temp_env"
  rm -f "$temp_artifact"
}

trap cleanup EXIT

generate_smoke_secret() {
  local value
  value="$(openssl rand -base64 32 | tr -d '\r\n')"
  if [[ ${#value} -lt 32 ]]; then
    echo 'Failed to generate a sufficiently long smoke secret' >&2
    exit 1
  fi
  printf '%s' "$value"
}

smoke_admin_token="$(generate_smoke_secret)" || exit 1
smoke_internal_secret="$(generate_smoke_secret)" || exit 1
smoke_probe_secret="$(generate_smoke_secret)" || exit 1
smoke_browser_audit_secret="$(generate_smoke_secret)" || exit 1

cp "$env_template" "$temp_env"

SMOKE_ADMIN_TOKEN="$smoke_admin_token" \
SMOKE_INTERNAL_SECRET="$smoke_internal_secret" \
SMOKE_PROBE_SECRET="$smoke_probe_secret" \
SMOKE_BROWSER_AUDIT_SECRET="$smoke_browser_audit_secret" \
python3 - "$temp_env" "$profile" <<'PY'
import os
from pathlib import Path
import sys

env_path = Path(sys.argv[1])
profile = sys.argv[2]
values = {}

for raw in env_path.read_text().splitlines():
    if not raw or raw.lstrip().startswith('#') or '=' not in raw:
        continue
    key, value = raw.split('=', 1)
    values[key] = value

values['SELFHOST_ADMIN_TOKEN'] = os.environ['SMOKE_ADMIN_TOKEN']
values['SELFHOST_INTERNAL_SECRET'] = os.environ['SMOKE_INTERNAL_SECRET']
values['PROBE_SHARED_SECRET'] = os.environ['SMOKE_PROBE_SECRET']
values['BROWSER_AUDIT_SHARED_SECRET_NEXT'] = ''
values['BROWSER_AUDIT_SHARED_SECRET'] = os.environ['SMOKE_BROWSER_AUDIT_SECRET']
values['CONSOLE_PUBLIC_PORT'] = '0'
values['SELFHOST_API_DEBUG_PORT'] = '0'
values['BROWSER_AUDIT_DEBUG_PORT'] = '0'
# Disable the embedded scheduler in smoke tests so the API's /health
# healthcheck passes faster; the scheduler dispatch loop is not under
# test here.
values['SELFHOST_SCHEDULER_MODE'] = 'disabled'

if profile == 'browser-audit':
    values['SELFHOST_BROWSER_AUDIT_BASE_URL'] = 'http://browser-audit-lighthouse:8080'
else:
    values['SELFHOST_BROWSER_AUDIT_BASE_URL'] = ''

env_path.write_text(''.join(f'{key}={value}\n' for key, value in values.items()))
PY

profile_args=()
if [[ "$profile" == "browser-audit" ]]; then
  profile_args+=(--profile browser-audit)
fi

compose "${profile_args[@]}" up -d --build
console_mapping="$(compose "${profile_args[@]}" port console 3000)"
console_host_port="$(host_port_from_mapping "$console_mapping" "console")"
console_url="http://127.0.0.1:${console_host_port}"

for _ in {1..90}; do
  if curl -fsS "${console_url}/" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

# Final check — if console still unreachable, dump diagnostics before failing.
if ! curl -fsS "${console_url}/" >/dev/null 2>&1; then
  echo "=== CONSOLE UNREACHABLE — diagnostics ==="
  echo "--- compose port console 3000 ---"
  compose "${profile_args[@]}" port console 3000 2>&1 || true
  echo "--- console container logs ---"
  compose "${profile_args[@]}" logs --no-log-prefix --tail 30 console 2>&1 || true
  echo "--- api container logs ---"
  compose "${profile_args[@]}" logs --no-log-prefix --tail 15 api 2>&1 || true
  echo "--- docker ps ---"
  docker ps --format '{{.Names}} {{.Status}} {{.Ports}}' 2>&1 || true
  echo "=== END diagnostics ==="
  echo "Console failed to respond at ${console_url}" >&2
  exit 1
fi

if [[ "$console_mapping" != 127.0.0.1:* ]] && [[ "$console_mapping" != \[::1\]:* ]]; then
  echo "Expected console to bind on loopback, got ${console_mapping:-no mapping}" >&2
  exit 1
fi

assert_service_unpublished api "API" "${profile_args[@]}"

if [[ "$profile" == "browser-audit" ]]; then
  assert_service_unpublished browser-audit-lighthouse "Browser Audit runner" "${profile_args[@]}"

  browser_container_id="$(compose "${profile_args[@]}" ps -q browser-audit-lighthouse)"
  if [[ -z "$browser_container_id" ]]; then
    echo "Browser Audit runner container was not created" >&2
    exit 1
  fi
  browser_health=""
  for _ in {1..90}; do
    browser_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$browser_container_id")"
    if [[ "$browser_health" == "healthy" ]]; then
      break
    fi
    sleep 2
  done
  if [[ "$browser_health" != "healthy" ]]; then
    docker exec "$browser_container_id" bun -e '
      const response = await fetch("http://127.0.0.1:8080/healthz", {
        signal: AbortSignal.timeout(5000)
      });
      const body = await response.text();
      console.error(body.slice(0, 4096));
    ' >&2 || true
    compose "${profile_args[@]}" logs --no-color browser-audit-lighthouse >&2
    echo "Browser Audit runner did not become healthy (status: ${browser_health:-unknown})" >&2
    exit 1
  fi
fi

BASE_URL="$console_url" bun run smoke:console

compose --profile debug up -d --no-deps api-debug
api_debug_mapping="$(compose --profile debug port api-debug 8789)"
api_debug_host_port="$(host_port_from_mapping "$api_debug_mapping" "API debug proxy")"
api_debug_url="http://127.0.0.1:${api_debug_host_port}"

for _ in {1..60}; do
  if curl -fsS "${api_debug_url}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

curl -fsS "${api_debug_url}/health" >/dev/null
if [[ "$api_debug_mapping" != 127.0.0.1:* ]] && [[ "$api_debug_mapping" != \[::1\]:* ]]; then
  echo "Expected API debug proxy to bind on loopback, got ${api_debug_mapping:-no mapping}" >&2
  exit 1
fi

if [[ "$profile" == "browser-audit" ]]; then
  audit_response="$(
    curl -fsS -X POST "${api_debug_url}/v1/browser-audits" \
      -H "authorization: Bearer ${smoke_admin_token}" \
      -H 'content-type: application/json' \
      -d '{
        "targetUrl": "https://example.com",
        "policy": {
          "preset": "mobile",
          "flow": {
            "steps": [{ "type": "navigate", "url": "https://example.com" }]
          }
        }
      }'
  )"

  bun -e '
    const payload = JSON.parse(process.argv[1]);
    if (payload.status !== "queued") {
      throw new Error(`Expected queued browser audit, got ${payload.status}`);
    }
  ' "$audit_response"

  audit_id="$(bun -e 'console.log(JSON.parse(process.argv[1]).id)' "$audit_response")"
  audit_detail="$audit_response"
  audit_status="queued"
  for _ in {1..60}; do
    audit_detail="$(
      curl -fsS "${api_debug_url}/v1/browser-audits/${audit_id}" \
        -H "authorization: Bearer ${smoke_admin_token}"
    )"
    audit_status="$(bun -e 'console.log(JSON.parse(process.argv[1]).status)' "$audit_detail")"
    if [[ "$audit_status" == "succeeded" || "$audit_status" == "failed" ]]; then
      break
    fi
    sleep 2
  done

  if [[ "$audit_status" != "succeeded" && "$audit_status" != "failed" ]]; then
    echo "Browser Audit ${audit_id} timed out while waiting for a terminal status" >&2
    exit 1
  fi

  if [[ "$audit_status" == "failed" ]]; then
    echo "Browser Audit ${audit_id} failed; bounded API detail follows" >&2
    bun -e '
      const payload = JSON.parse(process.argv[1]);
      console.error(JSON.stringify(payload).slice(0, 4096));
    ' "$audit_detail" >&2 || true
    echo "Recent Browser Audit service logs follow" >&2
    compose "${profile_args[@]}" logs --no-color --tail 120 \
      browser-audit-lighthouse executor api >&2 || true
  fi

  bun -e '
    const payload = JSON.parse(process.argv[1]);
    if (payload.status !== "succeeded") {
      throw new Error(`Expected succeeded browser audit, got ${payload.status}`);
    }
    if (!payload.result?.artifacts?.length) {
      throw new Error("Expected the browser audit to persist at least one artifact");
    }
  ' "$audit_detail"

  artifact_url="$(bun -e '
    const artifact = JSON.parse(process.argv[1]).result.artifacts[0];
    if (!artifact.url.startsWith("/v1/browser-audits/") || !artifact.sha256) {
      throw new Error("Expected a local artifact reference with a SHA-256 digest");
    }
    console.log(artifact.url);
  ' "$audit_detail")"
  expected_sha256="$(bun -e '
    console.log(JSON.parse(process.argv[1]).result.artifacts[0].sha256);
  ' "$audit_detail")"
  unauthenticated_status="$(
    curl -sS -o /dev/null -w '%{http_code}' "${api_debug_url}${artifact_url}"
  )"
  if [[ "$unauthenticated_status" != "401" ]]; then
    echo "Expected unauthenticated artifact download to return 401, got ${unauthenticated_status}" >&2
    exit 1
  fi
  curl -fsS "${api_debug_url}${artifact_url}" \
    -H "authorization: Bearer ${smoke_admin_token}" \
    -o "$temp_artifact"
  if [[ ! -s "$temp_artifact" ]]; then
    echo "Expected a non-empty Browser Audit artifact download" >&2
    exit 1
  fi
  downloaded_sha256="$(bun -e '
    const { createHash } = await import("node:crypto");
    const { readFile } = await import("node:fs/promises");
    console.log(createHash("sha256").update(await readFile(process.argv[1])).digest("hex"));
  ' "$temp_artifact")"
  if [[ "$downloaded_sha256" != "$expected_sha256" ]]; then
    echo "Artifact SHA-256 mismatch: expected ${expected_sha256}, got ${downloaded_sha256}" >&2
    exit 1
  fi
fi

echo "{\"ok\":true,\"profile\":\"$profile\"}"
