---
npm/@webperf/contracts: minor
---

Publish the stateless `webperf-probe` capability contract used by both
self-hosted WebPerf and WebPerf & Guide Managed. The Rust probe now
reports its configured region, immutable runtime provenance, transport limits,
and admission limit, echoes correlation identifiers in measurement responses,
rejects mismatched regions, and fails fast with `429` when its configurable
in-flight guard is exhausted.
