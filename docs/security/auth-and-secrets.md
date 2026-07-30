# Self-host authentication and secrets

WebPerf self-hosted uses a trusted, single-organization security model. It does
not implement SaaS users, workspaces, seats, or tenant isolation.

## Required secrets

Every production service must receive explicit values for:

- `SELFHOST_ADMIN_TOKEN`: console-to-API and direct operator API access;
- `SELFHOST_INTERNAL_SECRET`: scheduler/executor-to-API access and the current
  SQLite payload-encryption key source;
- `PROBE_SHARED_SECRET`: HMAC signing between the executor and Rust probe;
- `BROWSER_AUDIT_SHARED_SECRET`: HMAC signing between the executor and Browser
  Audit runner.

Each variable accepts an optional `_NEXT` counterpart during rotation. There
are no production fallback values. `bun run selfhost:init` creates a new
`infra/docker-compose/.env` with cryptographically random current secrets and
refuses to overwrite an existing file.

The console reads `SELFHOST_ADMIN_TOKEN` only in its server process and adds it
to upstream API requests. It is never serialized into page data or browser
JavaScript.

## API boundary

Only these discovery endpoints are unauthenticated:

- `GET /health` (minimal readiness response);
- `GET /v1/capabilities`;
- `GET /openapi/public.json`.

All other REST and RPC routes require
`Authorization: Bearer <SELFHOST_ADMIN_TOKEN>`. Internal routes such as
`POST /v1/scheduler/dispatch` require the internal secret instead. Failed
authentication returns `401` and a Bearer challenge without reflecting the
supplied token.

`GET /v1/runtime-metrics` is shared by both deployment modes: a full
self-hosted runtime accepts the administrator token, while a regional runtime
accepts its dedicated current/next regional-runtime secret.

## Persistence and display

SQLite JSON payloads are encrypted with AES-256-GCM using an HKDF-derived,
domain-separated key. On the first upgraded start, legacy plaintext and v1
envelopes are transactionally rewritten and recorded in `schema_migrations`;
after that marker exists, plaintext payloads are rejected rather than silently
accepted. New writes use the current internal secret; reads accept the current
and optional next secret so operators can rotate without taking the service
offline. API, RPC, SSE, export, and Browser Audit artifact text paths mask
sensitive headers, cookie values, webhook secrets, upload tokens, and URL query
values. Browser Audit artifact redaction handles adjacent or malformed URLs and
uses context-aware masking for values shorter than eight characters so numeric
metrics are not corrupted by blanket single-character replacement.

Sensitive header matching includes `authorization`, `cookie`, `set-cookie`,
`proxy-authorization`, `x-api-key`, `api-key`, and custom names containing a
standalone `token`, `secret`, or `key` segment. A masked value submitted during
a Check update preserves the already-encrypted value instead of replacing it.
The same marker is rejected when a new sensitive header or webhook target has
no previous secret to preserve.

## Network policy

The Rust probe validates every redirect, rejects private/local/reserved IPv4
and IPv6 ranges, and pins the validated DNS addresses into reqwest so the
connection does not perform a second untrusted lookup. The Browser Audit runner
validates targets and every flow navigation, intercepts redirects and
subresources, blocks non-HTTP schemes, downloads, and new windows, and rejects
private/local/metadata DNS answers. Each audit also launches a loopback-only
HTTP/CONNECT proxy: the proxy resolves and validates each destination once,
then connects directly to that pinned IP so Chrome cannot perform a second DNS
lookup after validation. QUIC and non-proxied WebRTC UDP are disabled.

`BROWSER_AUDIT_HOST_ALLOWLIST` is an explicit comma-separated operator escape
hatch for exact hosts or `*.example.test` patterns. Allowlisting a private host
removes the public-internet-only address restriction for that host, but the
proxy still pins the actual DNS answer. Use this only on an isolated runner
network.

## Exposure warning

Do not expose the console directly to the public internet. For remote access,
put it behind a TLS reverse proxy and an additional access-control layer such
as a private network, an identity-aware proxy, or HTTP authentication. Those
products are deployment options, not core dependencies.
