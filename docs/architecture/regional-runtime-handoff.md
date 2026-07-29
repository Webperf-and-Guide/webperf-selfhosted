# Regional runtime handoff

Regional Runtime Protocol v1 is the provider-neutral boundary between a
managed control plane and one fixed-location WebPerf execution runtime. This
repository owns the protocol, durable execution behavior, release images, and
deployment profile. Managed region selection, provider credentials,
deploy/undeploy policy, global aggregation, billing, and tenancy stay outside
this repository.

## Runtime shape

```text
Managed control plane
  │ signed HTTPS
  ▼
regional-api        webperf image, role regional-runtime
  │ durable SQLite queue
  ▼
regional-executor   webperf image, role executor
  │ signed local request
  ▼
Rust probe          webperf-probe image
  │
  ▼
public target URL
```

The regional role exposes no Console, scheduler, Sites, Route Groups, Checks,
Reports, Browser Audit, app RPC, or ops RPC. Internal executor routes remain
available only to the executor credential.

Version 1 is intentionally network-probe-only. Browser Audit requires a
different target contract for flow, policy, viewport, and artifacts and is not
accepted by this protocol version.

## Configuration

Select the role directly:

```dotenv
WEBPERF_ROLE=regional-runtime
SELFHOST_REGION_ID=tokyo
SELFHOST_REGION_LABEL=Tokyo
SELFHOST_INTERNAL_SECRET=...
REGIONAL_RUNTIME_SHARED_SECRET=...
REGIONAL_RUNTIME_SHARED_SECRET_NEXT=
SELFHOST_PROBE_BASE_URL=http://127.0.0.1:8080
SELFHOST_SCHEDULER_MODE=disabled
WEBPERF_RUNTIME_VERSION=...
WEBPERF_RUNTIME_IMAGE_DIGEST=sha256:...
WEBPERF_PROBE_IMAGE_DIGEST=sha256:...
```

The role dispatcher forces `SELFHOST_RUNTIME_MODE=regional-runtime`; callers
cannot accidentally select the role while leaving the full API enabled.

Regional mode does not require `SELFHOST_ADMIN_TOKEN`. The internal executor
credential, Cloud handoff credential, and probe credential remain independent.
Current/next values support planned rotation.

The reference deployment files are under
[`infra/regional-runtime`](../../infra/regional-runtime/README.md).

## HTTP surface

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | Public | Minimal process health |
| `GET` | `/v1/regional-capabilities` | Public | Protocol, region, limits, provenance |
| `GET` | `/openapi/regional-runtime.json` | Public | oRPC-derived OpenAPI document |
| `POST` | `/v1/regional-executions` | Regional bearer + body HMAC | Submit or retry a batch |
| `GET` | `/v1/regional-executions/:idempotencyKey` | Regional bearer | Poll signed status |
| `DELETE` | `/v1/regional-executions/:idempotencyKey` | Regional bearer | Cancel non-terminal work |

All other external paths return `404` in regional mode, including requests
that carry an otherwise valid self-host administrator token.

Regional responses use `Cache-Control: no-store`. Managed ingress must preserve
that policy and must not cache execution status.

## Submit semantics

`POST /v1/regional-executions` accepts:

- one safe `idempotencyKey`;
- `runnerType=network_probe`;
- 1–100 unique targets;
- a deadline up to 15 minutes;
- 1–20 attempts per target;
- an RFC 3339 request timestamp;
- `current` or `next` key version;
- a lowercase hex HMAC-SHA256 signature.

The runtime rejects request timestamps outside the five-minute replay window.
The signature covers the canonical request fields with stable key ordering.
URLs pass the same HTTP(S), port, credential, and special-address validation as
standalone Fast Checks.

The semantic idempotency digest excludes transport rotation fields
(`timestamp`, `keyVersion`, and `signature`). A caller may safely retry the
same work with a fresh timestamp or rotated key:

- same key + same semantic work returns the existing execution;
- same key + different target/deadline/attempt policy returns `409`;
- concurrent duplicates are resolved atomically in SQLite.

The API writes the regional record, target jobs, and durable execution queue in
one transaction. Batches larger than the executor payload limit are split into
ordered chunks while preserving the original target order.

## Polling, deadline, and cancellation

`GET` returns a signed aggregate with:

- execution status;
- ordered per-target status and timing result;
- fixed region provenance;
- distinct runtime and probe image provenance;
- accepted/completed timestamps;
- the response key version and HMAC signature.

The result is signed with the same key version that authenticated the accepted
request. During rotation, the caller must retain that current/next key until
the execution reaches a terminal state.

The accepted deadline is persisted and also propagated to the executor. If it
expires:

- queued and leased execution chunks become terminal failures;
- active probe work is aborted through the executor signal;
- subsequent polling returns a signed failed result.

`DELETE` is idempotent. It cancels queued or in-flight work and returns the
signed aggregate. It does not rewrite a previously succeeded or failed
execution as cancelled.

SQLite-backed jobs and records survive API/executor restart. If a process
stops, an expired lease can be reclaimed by the executor and the same
idempotency key continues to address the original work.

## Deployment invariants

Regional Runtime v1 requires:

- one fixed region identity per deployment;
- exactly one active pod/replica;
- API, executor, and probe in the same provider location;
- one persistent `/data` volume attached to the API;
- only API port `8788` exposed through TLS ingress;
- executor and probe remaining private;
- API and executor using the same immutable `webperf` digest;
- probe using the matching immutable `webperf-probe` digest.

The single-replica requirement is deliberate. Separate pods have independent
SQLite databases and cannot safely serve the same idempotency key. A future
shared-state protocol revision is required before horizontal replicas can be
enabled.

Providers that colocate several containers in one network namespace use the
machine-readable
[`multi-container-profile.json`](../../infra/regional-runtime/multi-container-profile.json).
Its containers communicate through `127.0.0.1` on distinct ports. The
reference Compose file uses service DNS because ordinary Compose containers do
not share a network namespace.

## Release handoff

Tagged releases contain:

- `runtime-metadata.json` with immutable image digests;
- `regional-runtime.compose.yml`;
- `regional-runtime.env.example`;
- `regional-runtime-profile.json`;
- `regional-runtime.README.md`.

Managed consumers must select all artifacts from the same tagged release.
They must not mix mutable `main` tags or infer a runtime digest from source.

## Product boundary

This protocol must remain free of:

- workspaces, users, plans, quotas, or FCU metering;
- managed region catalogs and Region Sets;
- provider application IDs or access keys;
- deploy/undeploy and warm-capacity policy;
- global fan-out or cross-region aggregation;
- AI analysis.

Those concerns belong to `webperf.and.guide`. The public runtime only accepts a
bounded request for its fixed location and returns signed, reproducible
measurement evidence.
