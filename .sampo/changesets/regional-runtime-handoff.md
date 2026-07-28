---
npm/@webperf/contracts: minor
---

Add the regional runtime handoff protocol contracts. Define a
provider-neutral execution boundary (`regionalRuntimeCapabilitiesSchema`,
`regionalExecutionRequestSchema`, `regionalExecutionResultSchema`,
`regionalExecutionStatusSchema`) that a managed Cloud control plane can
call to submit signed, idempotent measurement requests to one regional
runtime. Includes bounded route batches (1–100 targets), deadline/cancel
semantics, HMAC-SHA256 signed result delivery with current/next key
rotation, and a provenance block (region id, runner type, probe impl,
image digest, runtime version). No Cloud-only logic (billing, tenancy,
fleet) enters this repository.
