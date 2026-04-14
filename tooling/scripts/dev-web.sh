#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/../.."
exec bash tooling/scripts/dev-console.sh edge
