---
npm/@webperf/contracts: minor
npm/@webperf/domain-core: minor
---

Add date-range (`createdAfter`/`createdBefore`) and exact `checkId`
filtering to the comparison, export, and analysis list endpoints. The new
`derivedResourceListQuerySchema` extends the shared `listQuerySchema`
with these optional fields, and `applyDerivedResourceListQuery` in
`@webperf/domain-core` applies them before text-search and pagination.
