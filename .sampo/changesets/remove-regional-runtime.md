---
npm/@webperf/config: minor
npm/@webperf/contracts: minor
npm/@webperf/domain-core: minor
---

Remove the superseded Regional Runtime API, contracts, execution mode, and
deployment profile. WebPerf Self-hosted remains a complete single-location
application, while WebPerf & Guide Managed orchestrates the
versioned stateless `webperf-probe` image through its private control plane.
Released SQLite migrations and retention cleanup remain compatible with
databases created by WebPerf 0.3.0.
