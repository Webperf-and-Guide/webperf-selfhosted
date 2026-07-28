---
npm/@webperf/config: minor
---

Add `SELFHOST_RUNTIME_MODE` (`full` | `regional-runtime`, default `full`)
to the self-host API environment schema. When set to `regional-runtime`,
the deployment serves as a regional execution runtime for the managed
Cloud control plane. The `WEBPERF_ROLE=regional-runtime` dispatcher entry
and API capabilities/health reporting are updated to surface the runtime
mode.
