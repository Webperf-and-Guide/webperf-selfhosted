#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
compose_file="$root_dir/infra/docker-compose/compose.yml"
dev_compose_file="$root_dir/infra/docker-compose/compose.dev.yml"
compose_project="webperf-smoke-$$"
profile="${COMPOSE_PROFILE:-default}"
temp_env="$(mktemp)"
temp_artifact="$(mktemp)"

compose() {
  docker compose \
    --project-name "$compose_project" \
    --env-file "$temp_env" \
    -f "$compose_file" \
    -f "$dev_compose_file" \
    "$@"
}

assert_service_unpublished() {
  local service="$1"
  local label="$2"
  local container_id
  local published_bindings

  container_id="$(compose "${profile_args[@]}" ps -q "$service")"
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

cleanup() {
  compose --profile browser-audit --profile debug down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$temp_env"
  rm -f "$temp_artifact"
}

trap cleanup EXIT

cp "$root_dir/infra/docker-compose/.env.example" "$temp_env"

python3 - "$temp_env" "$profile" <<'PY'
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

values['SELFHOST_ADMIN_TOKEN'] = 'smoke-admin-token-value'
values['SELFHOST_INTERNAL_SECRET'] = 'smoke-internal-secret-value'
values['PROBE_SHARED_SECRET'] = 'smoke-probe-shared-secret'
values['BROWSER_AUDIT_SHARED_SECRET_NEXT'] = ''
values['BROWSER_AUDIT_SHARED_SECRET'] = 'smoke-browser-audit-shared-secret'

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

for _ in {1..90}; do
  if curl -fsS http://127.0.0.1:5173/ >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

curl -fsS http://127.0.0.1:5173/ >/dev/null

console_mapping="$(compose "${profile_args[@]}" port console 3000)"
if [[ "$console_mapping" != 127.0.0.1:* ]] && [[ "$console_mapping" != \[::1\]:* ]]; then
  echo "Expected console to bind on loopback, got ${console_mapping:-no mapping}" >&2
  exit 1
fi

assert_service_unpublished api "API"

if [[ "$profile" == "browser-audit" ]]; then
  assert_service_unpublished browser-audit-lighthouse "Browser Audit runner"

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
    compose "${profile_args[@]}" logs --no-color browser-audit-lighthouse >&2
    echo "Browser Audit runner did not become healthy (status: ${browser_health:-unknown})" >&2
    exit 1
  fi
fi

bun run smoke:console

compose --profile debug up -d --no-deps api-debug

for _ in {1..60}; do
  if curl -fsS http://127.0.0.1:8788/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

curl -fsS http://127.0.0.1:8788/health >/dev/null
api_debug_mapping="$(compose --profile debug port api-debug 8789)"
if [[ "$api_debug_mapping" != 127.0.0.1:* ]] && [[ "$api_debug_mapping" != \[::1\]:* ]]; then
  echo "Expected API debug proxy to bind on loopback, got ${api_debug_mapping:-no mapping}" >&2
  exit 1
fi

if [[ "$profile" == "browser-audit" ]]; then
  audit_response="$(
    curl -fsS -X POST http://127.0.0.1:8788/v1/browser-audits \
      -H 'authorization: Bearer smoke-admin-token-value' \
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
      curl -fsS "http://127.0.0.1:8788/v1/browser-audits/${audit_id}" \
        -H 'authorization: Bearer smoke-admin-token-value'
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
    curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:8788${artifact_url}"
  )"
  if [[ "$unauthenticated_status" != "401" ]]; then
    echo "Expected unauthenticated artifact download to return 401, got ${unauthenticated_status}" >&2
    exit 1
  fi
  curl -fsS "http://127.0.0.1:8788${artifact_url}" \
    -H 'authorization: Bearer smoke-admin-token-value' \
    -o "$temp_artifact"
  if [[ ! -s "$temp_artifact" ]]; then
    echo "Expected a non-empty Browser Audit artifact download" >&2
    exit 1
  fi
  downloaded_sha256="$(bun -e '
    const bytes = await Bun.file(process.argv[1]).arrayBuffer();
    console.log(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"));
  ' "$temp_artifact")"
  if [[ "$downloaded_sha256" != "$expected_sha256" ]]; then
    echo "Artifact SHA-256 mismatch: expected ${expected_sha256}, got ${downloaded_sha256}" >&2
    exit 1
  fi
fi

echo "{\"ok\":true,\"profile\":\"$profile\"}"
