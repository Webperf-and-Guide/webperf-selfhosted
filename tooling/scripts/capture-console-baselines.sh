#!/usr/bin/env bash
set -euo pipefail

command -v npx >/dev/null 2>&1

export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-0}"
npx --yes playwright install chromium >/dev/null
bun run tooling/scripts/capture-console-baselines.ts
