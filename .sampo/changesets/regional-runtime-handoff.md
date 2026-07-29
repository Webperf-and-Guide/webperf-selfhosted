---
npm/@webperf/contracts: minor
npm/@webperf/domain-core: minor
---

Add the regional runtime handoff protocol contracts. Define a
provider-neutral execution boundary (`regionalRuntimeCapabilitiesSchema`,
`regionalExecutionRequestSchema`, `regionalExecutionResultSchema`,
`regionalExecutionStatusSchema`) that a managed Cloud control plane can
call to submit signed, idempotent network-probe requests to one regional
runtime. Includes bounded route batches (1–100 targets), deadline/cancel
semantics, strict HMAC-SHA256 request/result helpers with current/next key
rotation, semantic request digests, and distinct runtime/runner image
provenance. Browser Audit is intentionally deferred to a separate request
variant. No Cloud-only logic (billing, tenancy, fleet) enters this
repository.
