# WebPerf Self-hosted and WebPerf & Guide Managed

`WebPerf & Guide` is the product brand. This repository and the managed
edition have a
deliberate ownership boundary.

| Capability | WebPerf Self-hosted | WebPerf & Guide Managed |
| --- | --- | --- |
| Installation and upgrades | Operator-owned Compose release | Managed |
| Organization model | One trusted organization | Hosted identities, teams, and workspaces |
| Data | Operator SQLite and local artifact volume | Hosted storage and retention |
| Execution | Operator probes and optional runner | Managed orchestration and runner fleet |
| Contracts and reports | Source of truth | Consumes public versions |
| Billing, quotas, seats | Not included | Managed product concern |
| Provider credentials and ops | Not included | Private managed concern |
| AI analyst features | Not included | Possible managed product layer |

## What remains public source of truth

Self-host operators can independently use the console, API, scheduler, durable
executor, Rust probe, optional Lighthouse reference runner, SQLite persistence,
artifact storage, public contracts, domain models, comparisons, deterministic
analysis, exports, and vendor-neutral deployment examples.

The managed product should consume versioned `@webperf/*` contracts and the
digest-bearing `webperf-probe` entry from a specific self-host GitHub Release.
It must not copy public schema source or infer production probe identity from
a mutable `main` tag.

## What stays out of this repository

Multi-tenant authentication, billing, quotas, seats, managed fleet scaling,
hosted retention, private anti-abuse logic, internal admin tools,
provider-specific orchestration, and managed-service collaboration features belong to
`webperf.and.guide`.

The decision rule is simple: if a self-host operator can use a feature
independently, it belongs here; if its value depends on managed hosting,
automation, tenancy, or billing, it belongs in the managed product.

## Managed probe consumption

WebPerf & Guide Managed runs the public, stateless
`webperf-probe` image in its regional provider fleet. Global fan-out,
deploy/undeploy lifecycle, queueing, aggregation, FCU metering, and plan
enforcement are private managed-service concerns. The full self-hosted
application is not a managed worker protocol; operators who want their own
multi-region deployment can compose the probe contract independently.

See the detailed [product boundary](../comparison/managed-service-vs-selfhosted.md) and
[feature scope](../self-hosting/feature-scope.md).
