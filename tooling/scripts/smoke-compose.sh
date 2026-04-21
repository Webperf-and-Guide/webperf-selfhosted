#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
compose_file="$root_dir/infra/docker-compose/docker-compose.yml"
profile="${COMPOSE_PROFILE:-default}"
temp_env="$(mktemp)"

cleanup() {
  local extra_args=()
  if [[ "$profile" == "browser-audit" ]]; then
    extra_args+=(--profile browser-audit)
  fi

  docker compose --env-file "$temp_env" "${extra_args[@]}" -f "$compose_file" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$temp_env"
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

values['PROBE_SHARED_SECRET'] = 'dev-shared-secret'
values['BROWSER_AUDIT_SHARED_SECRET_NEXT'] = ''
values['SELFHOST_BROWSER_AUDIT_BASE_URL'] = 'http://browser-audit-worker:8080'

if profile == 'browser-audit':
    values['BROWSER_AUDIT_SHARED_SECRET'] = 'dev-browser-audit-shared-secret'
else:
    values['BROWSER_AUDIT_SHARED_SECRET'] = ''

env_path.write_text(''.join(f'{key}={value}\n' for key, value in values.items()))
PY

extra_args=()
if [[ "$profile" == "browser-audit" ]]; then
  extra_args+=(--profile browser-audit)
fi

docker compose --env-file "$temp_env" "${extra_args[@]}" -f "$compose_file" up -d --build

for _ in {1..60}; do
  if curl -fsS http://127.0.0.1:8788/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

curl -fsS http://127.0.0.1:8788/health >/dev/null
bun run smoke:console

if [[ "$profile" == "browser-audit" ]]; then
  curl -fsS http://127.0.0.1:8081/healthz >/dev/null
  audit_response="$(
    curl -fsS -X POST http://127.0.0.1:8788/v1/browser-audits \
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
    if (payload.status !== "succeeded") {
      throw new Error(`Expected succeeded browser audit, got ${payload.status}`);
    }
  ' "$audit_response"
fi

echo "{\"ok\":true,\"profile\":\"$profile\"}"
