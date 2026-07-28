# Regional runtime handoff

Phase 4 of issue #14 defines a **provider-neutral execution boundary** that
a managed Cloud control plane can call to submit measurement work to one
regional runtime. This repository defines the public protocol; managed
orchestration, billing, tenancy, and fleet scaling stay in the Cloud
product.

## Boundary

```text
WebPerf Cloud control plane
├─ POST /v1/regional-executions      (idempotent request + HMAC signature)
├─ GET /v1/regional-executions/:id    (status poll)
└─ DELETE /v1/regional-executions/:id (cancel)

Regional runtime (one self-host deployment, one fixed region)
├─ validates HMAC-SHA256 signature (current/next key rotation)
├─ executes each target via the configured probe
├─ stamps provenance (region id, runner type, probe impl, image digest)
└─ returns signed result on poll or push
```

A regional runtime does **not** run a Console, self-host scheduler, Region
Set, Check, Site, billing, workspace, or managed fleet logic. It only
accepts execution requests, measures, and returns results.

## Configuration

A deployment becomes a regional runtime by setting `WEBPERF_ROLE=api` with
`SELFHOST_RUNTIME_MODE=regional-runtime`. In this mode the API reports
runtime capabilities (runner types, batch limits, deadline bounds) through
`GET /v1/regional-capabilities` instead of the full self-host health payload.

The existing `SELFHOST_REGION_ID` / `SELFHOST_PROBE_BASE_URL` pair
identifies the runtime's fixed measurement location.

## Protocol

### Idempotent execution request

The Cloud submits a signed `RegionalExecutionRequest` with:

- **`idempotencyKey`** — the runtime deduplicates requests with the same key
- **`runnerType`** — `network_probe` or `browser_audit`
- **`targets`** — bounded route batch (1–100 targets, each with URL + optional
  request overrides)
- **`deadlineMs`** — execution deadline from acceptance
- **`maxAttempts`** — per-target retry limit (1–20)
- **`timestamp`** — RFC 3339 timestamp for replay protection
- **`signature`** / **`keyVersion`** — HMAC-SHA256 over the canonical payload

The signing payload uses the fields listed in `regionalExecutionSignatureFields`
with stable key ordering, mirroring the probe `/measure` HMAC pattern.

### Status and cancellation

The Cloud polls `GET /v1/regional-executions/:idempotencyKey` for status.
Each target carries its own `RegionalExecutionTargetResult` with status,
latency, HTTP code, and error fields. The runtime signs the result payload
(`regionalResultSignatureFields`) with the same HMAC current/next key scheme.

Cancellation uses `DELETE /v1/regional-executions/:idempotencyKey`. The
runtime aborts in-flight targets via `AbortSignal`, matching the existing
executor graceful-shutdown pattern.

### Provenance

Every result carries a `RegionalExecutionProvenance` block:

- `regionId` — the runtime's fixed region identity
- `runnerType` — `network_probe` or `browser_audit`
- `probeImpl` — `go` or `rust`
- `runtimeVersion` — WebPerf runtime version (matches `VERSION`)
- `imageDigest` — OCI digest of the `webperf` image the runtime runs

This gives the Cloud control plane immutable evidence of where and how each
measurement was taken, without importing fleet or billing metadata.

## Provider-neutral constraint

The contracts in `packages/contracts/src/regional-runtime.ts` must not
reference Cloud-only concepts:

- no billing, quotas, seats, or usage metering
- no multi-tenant authentication or workspace identity
- no managed fleet scaling or provider-specific credentials
- no AI analyst product features

If a future enhancement needs any of these, it belongs in the managed Cloud
repository, not here.
