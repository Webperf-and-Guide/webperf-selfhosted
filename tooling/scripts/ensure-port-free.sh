#!/usr/bin/env bash
set -euo pipefail

port="${1:?port is required}"
label="${2:-service}"
hint="${3:-}"

if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "$label port $port is already in use." >&2
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2 || true
  if [[ -n "$hint" ]]; then
    echo "$hint" >&2
  fi
  exit 1
fi
