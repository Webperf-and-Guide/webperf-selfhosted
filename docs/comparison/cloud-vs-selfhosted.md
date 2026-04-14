# Cloud Vs Self-Hosted

`WebPerf` is the product brand.

The product boundary is:

- `webperf-selfhosted`: self-hosted OSS/open-core product
- `webperf.and.guide`: managed cloud product

## Self-Hosted Repo

`webperf-selfhosted` should stand on its own for a small single-org deployment.

It is the source of truth for:

- control-plane contracts and result schemas
- self-host API and scheduler behavior
- domain models such as sites, route groups, region sets, checks, runs, comparisons, and exports
- deterministic reporting and diff logic
- self-host console and API behavior
- Rust probe runtime and portable execution flow
- self-host deployment examples and install docs

It should include:

- manual checks
- scheduled dispatch via the bundled scheduler or webhook triggers
- baseline compare and latest-vs-previous compare
- JSON and CSV exports
- generic webhook delivery
- extension points for optional browser-audit adapters

It should not include:

- billing, quotas, or usage metering
- cloud-only orchestration and provider-managed runner fleets
- tenant/workspace auth and SaaS permission models
- hosted artifact retention policy
- private provider credentials or internal anti-abuse logic
- AI analyst product features

## Managed Cloud Repo

`webperf.and.guide` is the managed product and business layer.

It should include:

- marketing, pricing, and SEO landing pages
- login, teams, workspaces, and permission models
- managed control-plane orchestration
- hosted runner pools, queueing, and cloud workflows
- billing, quotas, and usage metering
- managed integrations and deployment gates
- customer notifications and retained hosted artifacts
- future AI product layers

It should consume public-core artifacts from `webperf-selfhosted` instead of re-owning them.

## Source Of Truth Rule

Shared public artifacts must originate in `webperf-selfhosted`.

That applies to:

- `@webperf/contracts`
- `@webperf/domain-core`
- `@webperf/report-core`
- `@webperf/config`
- browser-audit flow DSL, result, artifact, and worker request-response schemas
- other future public-safe adapters or schema packages

`webperf.and.guide` should consume those artifacts through versioned dependencies or local development links, not copied source trees.

## Boundary Test

When a change is ambiguous, use this test:

- if a self-host operator can use it independently, it belongs in `webperf-selfhosted`
- if it only becomes valuable through managed hosting, cloud orchestration, billing, multi-tenancy, or SaaS automation, it belongs in `webperf.and.guide`
