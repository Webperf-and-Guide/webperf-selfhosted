# WebPerf probe

Rust network probe runtime for self-hosted WebPerf.

The same stateless image is the public measurement boundary consumed by
WebPerf & Guide Managed at `webperf.and.guide`. The managed edition owns
provider deployment, regional fan-out, retries, persistence, aggregation,
tenancy, and billing; the probe only authenticates and performs one bounded
measurement.

## HTTP surface

- `GET /healthz` — process and configured-region health
- `GET /capabilities` — protocol, region, immutable provenance, and admission
  limits
- `POST /measure` — HMAC-authenticated single-target measurement

`POST /measure` rejects a signed request whose region does not match the
probe's configured `REGION_ID`. It also fails fast with `429` and a
`Retry-After` bound covering one full measurement lifecycle when all configured
slots are occupied. Callers own durable idempotency and retry state.

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PROBE_LISTEN_ADDR` | No | `0.0.0.0:8080` | HTTP listen address |
| `REGION_ID` | No | `local` | Stable provenance for this deployment |
| `PROBE_SHARED_SECRET` | Yes | — | Current request HMAC key |
| `PROBE_SHARED_SECRET_NEXT` | No | — | Staged rotation key |
| `PROBE_MAX_INFLIGHT` | No | `64` | Admission safety limit, `1..4096` |
| `WEBPERF_PROBE_VERSION` | No | — | Release version reported by capabilities |
| `WEBPERF_PROBE_IMAGE_DIGEST` | No | — | Immutable `sha256:` OCI digest |

The default concurrency is an admission guard, not a claim about maximum
throughput. Size it from observed peak arrival rate and measurement latency:

```text
required inflight
= peak requests/second
× p95 measurement seconds
× safety factor
```

The transport body ceiling remains 2 MiB. Product fields are bounded
separately by the public request contract; managed callers may enforce a
smaller policy without changing self-host compatibility.

Each outbound request has an 8-second timeout. With the four-redirect limit,
the advertised measurement lifecycle and capacity `Retry-After` bound are 40
seconds.

## Local run

```sh
cargo run -p probe-server --manifest-path apps/probe-rs/Cargo.toml
```

## Tests

```sh
cargo test --workspace --manifest-path apps/probe-rs/Cargo.toml
cargo clippy --workspace --all-targets --manifest-path apps/probe-rs/Cargo.toml -- -D warnings
```

## Docker build

Build a reusable image for either supported Linux architecture:

```sh
WEBPERF_PLATFORM=linux/arm64 # or linux/amd64
docker buildx build --platform "$WEBPERF_PLATFORM" --load \
  -t webperf-probe:dev ./apps/probe-rs
```
