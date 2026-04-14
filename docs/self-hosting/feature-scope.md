# Scope

This repository is the self-hosted/open-core WebPerf product.

It should remain useful on its own for release verification without requiring the managed cloud product at `webperf.and.guide`.

## Included

- manual checks
- saved sites, route groups, region sets, and check profiles
- scheduled dispatch via the bundled scheduler or external triggers
- baseline comparison and latest-vs-previous comparison
- deterministic report generation and export
- generic webhook alerting
- Docker Compose deployment
- public-safe contracts, schemas, and reporting logic
- portable execution flow with vendor-neutral extension points

## Allowed But Optional

- browser-audit adapters such as sitespeed integrations, when shipped as optional self-host extensions
- the Bun browser-audit worker runtime, when shipped as an optional self-host app rather than a default requirement
- machine-readable outputs that make later AI analysis easier without embedding AI product behavior here

## Not Included

- multi-tenant billing, quotas, or usage metering
- enterprise identity, seat management, or SaaS permission models
- provider-managed orchestration and hosted runner fleets
- private admin surfaces or internal ops tooling
- provider-specific premium routing guarantees
- hosted artifact retention policy
- AI analyst product features
