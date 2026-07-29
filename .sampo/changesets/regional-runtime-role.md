---
npm/@webperf/config: minor
---

Add `SELFHOST_RUNTIME_MODE` (`full` | `regional-runtime`, default `full`)
to the self-host API environment schema. When set to `regional-runtime`,
the deployment serves as a regional execution runtime for the managed
Cloud control plane and requires an isolated current/next handoff secret.
The `WEBPERF_ROLE=regional-runtime` dispatcher now forces the restricted
mode so role selection cannot accidentally expose the full self-host
surface, while optional immutable image metadata supports result
provenance.
