#!/usr/bin/env bash

random_secret() {
  bun -e 'console.log(crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", ""))'
}

export SELFHOST_ADMIN_TOKEN="${SELFHOST_ADMIN_TOKEN:-$(random_secret)}"
export SELFHOST_INTERNAL_SECRET="${SELFHOST_INTERNAL_SECRET:-$(random_secret)}"
export PROBE_SHARED_SECRET="${PROBE_SHARED_SECRET:-$(random_secret)}"
export BROWSER_AUDIT_SHARED_SECRET="${BROWSER_AUDIT_SHARED_SECRET:-$(random_secret)}"

unset -f random_secret
