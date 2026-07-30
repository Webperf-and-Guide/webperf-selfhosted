---
npm/@webperf/contracts: minor
---

Add an authenticated, provider-neutral runtime metrics contract at
`GET /v1/runtime-metrics` for both full self-host installations and
restricted regional runtimes. The snapshot reports durable execution queue
pressure, status and runner-kind counts, retry and expired-lease signals,
oldest-work ages, retention context, and the current single-replica SQLite
capacity boundary without exposing targets or persisted payloads.

Published release bundles now gate upgrades from the public `v0.2.1`
multi-region beta. The migration preserves historical target provenance,
requires explicit operator review before unsafe saved checks can run again,
creates a pre-migration backup, and is covered by automated backup, restore,
and cross-version Compose drills. Self-host documentation and console copy
now consistently describe one deployment as one fixed measurement location.
