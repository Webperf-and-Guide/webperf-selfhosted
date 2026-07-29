#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
compose_file="${WEBPERF_REGIONAL_SMOKE_COMPOSE_FILE:-$root_dir/infra/regional-runtime/compose.yml}"
dev_compose_file="${WEBPERF_REGIONAL_SMOKE_DEV_COMPOSE_FILE:-$root_dir/infra/regional-runtime/compose.dev.yml}"
env_template="${WEBPERF_REGIONAL_SMOKE_ENV_TEMPLATE:-$root_dir/infra/regional-runtime/.env.example}"
use_dev_override="${WEBPERF_REGIONAL_SMOKE_USE_DEV_OVERRIDE:-true}"
docker_config="${WEBPERF_REGIONAL_SMOKE_DOCKER_CONFIG:-}"
compose_project="webperf-regional-smoke-$$"
temp_env=''
smoke_pid=''
watchdog_pid=''

for required_file in "$compose_file" "$env_template"; do
  if [[ ! -f "$required_file" ]]; then
    echo "Required regional runtime smoke file is missing: $required_file" >&2
    exit 1
  fi
done

if [[ "$use_dev_override" != 'true' && "$use_dev_override" != 'false' ]]; then
  echo "WEBPERF_REGIONAL_SMOKE_USE_DEV_OVERRIDE must be true or false" >&2
  exit 1
fi

compose_files=(-f "$compose_file")
if [[ "$use_dev_override" == 'true' ]]; then
  if [[ ! -f "$dev_compose_file" ]]; then
    echo "Regional runtime development override is missing: $dev_compose_file" >&2
    exit 1
  fi
  compose_files+=(-f "$dev_compose_file")
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

temp_env="$(mktemp)"

cleanup() {
  if [[ -n "$smoke_pid" ]]; then
    kill -TERM "$smoke_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$watchdog_pid" ]]; then
    kill -TERM "$watchdog_pid" >/dev/null 2>&1 || true
  fi
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$temp_env" "${temp_env}.next"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cp "$env_template" "$temp_env"
internal_secret="$(openssl rand -hex 32)"
regional_secret="$(openssl rand -hex 32)"
probe_secret="$(openssl rand -hex 32)"

replace_env() {
  local key="$1"
  local value="$2"
  local next_file="${temp_env}.next"
  AWK_TARGET="$key" AWK_REPLACEMENT="$value" awk '
    BEGIN { found = 0 }
    index($0, ENVIRON["AWK_TARGET"] "=") == 1 {
      print ENVIRON["AWK_TARGET"] "=" ENVIRON["AWK_REPLACEMENT"]
      found = 1
      next
    }
    { print }
    END {
      if (!found) {
        print ENVIRON["AWK_TARGET"] "=" ENVIRON["AWK_REPLACEMENT"]
      }
    }
  ' "$temp_env" > "$next_file"
  mv "$next_file" "$temp_env"
}

replace_env SELFHOST_INTERNAL_SECRET "$internal_secret"
replace_env REGIONAL_RUNTIME_SHARED_SECRET "$regional_secret"
replace_env PROBE_SHARED_SECRET "$probe_secret"
replace_env SELFHOST_REGION_ID smoke-region
replace_env SELFHOST_REGION_LABEL "Smoke region"
replace_env REGIONAL_RUNTIME_PUBLIC_PORT 0

up_args=(up -d)
if [[ "$use_dev_override" == 'true' ]]; then
  up_args+=(--build)
fi
compose "${up_args[@]}"

api_mapping="$(compose port regional-api 8788)"
api_port="${api_mapping##*:}"
if [[ ! "$api_port" =~ ^[0-9]+$ ]]; then
  echo "Unable to resolve regional API host port from ${api_mapping:-no mapping}" >&2
  exit 1
fi
if [[ "$api_mapping" != 127.0.0.1:* ]] && [[ "$api_mapping" != \[::1\]:* ]]; then
  echo "Regional API must bind on loopback, got $api_mapping" >&2
  exit 1
fi
base_url="http://127.0.0.1:${api_port}"

api_healthy=false
for _ in {1..90}; do
  if curl -fsS "${base_url}/health" >/dev/null 2>&1; then
    api_healthy=true
    break
  fi
  sleep 2
done
if [[ "$api_healthy" != 'true' ]]; then
  echo 'Regional API did not become healthy within 180 seconds' >&2
  compose logs --tail 80 regional-api >&2 || true
  exit 1
fi

for service in regional-executor probe; do
  container_id="$(compose ps -q "$service")"
  if [[ -z "$container_id" ]]; then
    echo "Expected $service container to exist" >&2
    exit 1
  fi
  published="$(
    docker inspect \
      --format '{{range $port, $bindings := .HostConfig.PortBindings}}{{if $bindings}}{{$port}}{{end}}{{end}}' \
      "$container_id"
  )"
  if [[ -n "$published" ]]; then
    echo "$service must not publish a host port" >&2
    exit 1
  fi
  service_healthy=false
  for _ in {1..30}; do
    health="$(
      docker inspect \
        --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
        "$container_id"
    )"
    if [[ "$health" == 'healthy' ]]; then
      service_healthy=true
      break
    fi
    if [[ "$health" == 'unhealthy' || "$health" == 'exited' || "$health" == 'dead' ]]; then
      break
    fi
    sleep 2
  done
  if [[ "$service_healthy" != 'true' ]]; then
    echo "$service did not become healthy (last status: ${health:-unknown})" >&2
    compose logs --tail 80 "$service" >&2 || true
    exit 1
  fi
done

env \
  REGIONAL_RUNTIME_BASE_URL="$base_url" \
  REGIONAL_RUNTIME_SHARED_SECRET="$regional_secret" \
  REGIONAL_RUNTIME_EXPECTED_REGION=smoke-region \
  bun "$root_dir/tooling/scripts/smoke-regional-runtime.ts" &
smoke_pid="$!"
(
  sleep_pid=''
  trap 'if [[ -n "$sleep_pid" ]]; then kill -TERM "$sleep_pid" >/dev/null 2>&1 || true; fi; exit 0' TERM INT
  sleep 180 &
  sleep_pid="$!"
  wait "$sleep_pid"
  sleep_pid=''
  if kill -0 "$smoke_pid" >/dev/null 2>&1; then
    echo 'Regional runtime smoke process exceeded 180 seconds' >&2
    kill -TERM "$smoke_pid" >/dev/null 2>&1 || true
    sleep 5
    kill -KILL "$smoke_pid" >/dev/null 2>&1 || true
  fi
) &
watchdog_pid="$!"

set +e
wait "$smoke_pid"
smoke_status="$?"
set -e
smoke_pid=''
kill -TERM "$watchdog_pid" >/dev/null 2>&1 || true
wait "$watchdog_pid" >/dev/null 2>&1 || true
watchdog_pid=''
exit "$smoke_status"
