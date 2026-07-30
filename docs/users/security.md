# Security model

WebPerf self-hosted is designed for one trusted organization. It does not
provide SaaS user accounts, tenant isolation, seats, workspace permissions, or
a public multi-user login boundary.

## Public and protected endpoints

Only these API discovery endpoints are intentionally unauthenticated:

- `GET /health` — minimal liveness/readiness only;
- `GET /v1/capabilities` — implemented public capability flags;
- `GET /openapi/public.json` — public API description.

`GET /v1/health` is deliberately protected because it carries operational
detail. `GET /v1/runtime-metrics` is also protected because queue pressure and
retained work counts are operational data. Every other data or execution REST/RPC route requires
`SELFHOST_ADMIN_TOKEN`. Scheduler, executor, lease, and artifact-grant routes
require `SELFHOST_INTERNAL_SECRET`.

The default Compose stack publishes only the console on loopback. Keep it that
way. The `debug` profile is temporary, loopback-only diagnostic access and is
not an ingress design.

## Remote access

Put the console behind all of the following:

1. TLS with automatic renewal and modern protocol settings;
2. an additional access-control layer, such as a private network,
   identity-aware proxy, or HTTP authentication;
3. request logging and rate limits appropriate for the organization;
4. a proxy rule that forwards only to `127.0.0.1:5173`.

Cloudflare Access, Tailscale, and Basic Auth are examples, not core
dependencies. See [Reverse proxy](./reverse-proxy.md).

## Secrets and stored data

Use independent random secrets and protect `.env` and backups as sensitive
material. SQLite JSON payloads use AES-256-GCM with an HKDF-derived,
domain-separated key sourced from the internal secret. Sensitive headers,
cookies, webhook secrets, upload tokens, and query values are masked on API,
RPC, SSE, export, artifact-text, and diagnostic paths.

The administrator token remains in the console server process. Do not place it
in browser-visible environment variables, proxy headers sent to clients, CI
logs, or monitoring URLs.

## SSRF and outbound traffic

The Rust probe validates every redirect and pins validated public DNS answers
into the connection. The browser runner repeats public-network checks for
targets, navigations, redirects, and subresources, then routes Chrome through a
loopback proxy that connects to the validated IP instead of re-resolving the
hostname. It also blocks downloads and new windows. Webhook targets use the
same public URL policy and connect to a single validated, pinned DNS answer so
DNS rebinding cannot redirect a delivery into a private network. HTTPS is
required unless the executor's explicit legacy HTTP opt-in is enabled. Redirects are
reported as failures instead of being followed.

Private-host allowlists and insecure HTTP runtime toggles are explicit trust
expansions. Use them only with isolated networks and documented ownership.

## Browser sandbox

The optional runner uses Chromium's user-namespace sandbox with
`no-new-privileges`, no executable temporary mounts, and no default
`SYS_ADMIN`. On AppArmor 4 hosts, load the bundled `browser-audit.apparmor`
profile and use `compose.apparmor.yml`; this selects Chromium's recommended
unconfined `userns` allowlist for only that service without disabling AppArmor
globally. Compose drops all Linux capabilities and restores only `SYS_CHROOT`,
which Chromium needs to enter its sandbox root. Default-deny seccomp, the
read-only filesystem, private networking, and Chromium's own sandbox remain
enforced. Do not add a public port. Treat a no-sandbox exception as a degraded,
isolated runtime with no access to sensitive workloads.

## Operational controls

- Back up SQLite, artifacts, and the matching encryption secret together.
- Keep image digests, SBOMs, and attestations from the tagged release.
- Apply retention and log rotation so secrets are not preserved in incidental
  output.
- Review failed authentication, incident IDs, executor retry, and scheduler
  outage logs.
- Follow [SECURITY.md](../../SECURITY.md) for vulnerability reporting.

The detailed token, encryption, redaction, and network behavior is documented
in [authentication and secrets](../security/auth-and-secrets.md).
