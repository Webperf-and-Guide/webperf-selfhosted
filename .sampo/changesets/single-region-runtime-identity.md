---
npm/@webperf/contracts: patch
npm/@webperf/config: patch
---

Add the generic runtime region identity foundation that one standalone
deployment will own, in parallel with the legacy 41-city enum and
SELFHOST_*_JSON maps. Introduces `runtimeRegionIdSchema`,
`runtimeRegionLabelSchema`, and `runtimeLocationSchema` in `@webperf/contracts`,
plus `SELFHOST_REGION_ID`, `SELFHOST_REGION_LABEL`, and
`SELFHOST_PROBE_BASE_URL` in `@webperf/config` (default region id `local`,
no unverified city claim). This is the foundation slice of issue #14
Phase 1; the legacy multi-region model is removed in a follow-up PR.
