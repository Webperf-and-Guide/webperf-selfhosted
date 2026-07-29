---
npm/@webperf/contracts: minor
npm/@webperf/domain-core: minor
---

Add the regional runtime handoff protocol contracts. Define a
provider-neutral execution boundary (`regionalRuntimeCapabilitiesSchema`,
`regionalExecutionRequestSchema`, `regionalExecutionResultSchema`,
`regionalExecutionStatusSchema`) that a managed Cloud control plane can
call to submit signed, idempotent network-probe requests to one regional
runtime. The API now exposes contract-backed capabilities, create, status,
and cancel routes plus a dedicated OpenAPI document. It persists encrypted
idempotency records, atomically gives every target its own durable retry
budget, retains completed sibling results while a regional request can
still resume, enforces replay and execution deadlines, normalizes semantic
request defaults, supports current/next key rotation, and signs results
with distinct runtime/runner image provenance. Browser Audit is
intentionally deferred to a separate request variant. Tagged releases now
include the digest-pinned three-container Regional Runtime profile,
pre-populated provenance digests, synchronized source environment versions,
and a dedicated published-bundle smoke. No Cloud-only logic (billing,
tenancy, fleet) enters this repository.
