---
npm/@webperf/contracts: minor
npm/@webperf/config: minor
npm/@webperf/domain-core: minor
---

Remove the legacy 41-city region catalog, Region Pack/Region Set resources,
and multi-region selection from the self-host product. One standalone
deployment now measures from one fixed runtime location identified by
`SELFHOST_REGION_ID` (default `local`) and optional `SELFHOST_REGION_LABEL`;
the executor reads one `SELFHOST_PROBE_BASE_URL` origin; and the Rust probe
reads `REGION_ID` instead of `REGION_CODE`. The `/v1/region-packs` and
`/v1/region-sets` routes return 410 Gone. `createLatencyJobSchema.regions`,
`checkProfileSchema.regionPackId`, `regionPackSchema`, `regionCodeSchema`,
the `regionCatalog`/`buildRegionAvailabilityList`/`resolveRequestedRegions`
helpers, and the Console region catalog UI are removed. Result provenance
keeps a single `region` field per job, target, and Browser Audit. This is a
breaking change for self-host installs that relied on the multi-region
SaaS fan-out model; there is no production data to migrate.
