# executor

Single-concurrency durable execution worker for self-hosted WebPerf.

The executor claims encrypted SQLite-backed work through the API's internal
authenticated transport, renews leases while a handler runs, and stops claiming
new work during graceful shutdown. Network probe, Browser Audit, evaluation,
and webhook handlers are registered here rather than in the API or scheduler.

## Local run

```sh
bun run dev:executor
```

Copy environment values from `apps/executor/.env.example`. The internal secret
must match the API and scheduler value. The probe secret must match the Rust
probe, and `SELFHOST_PROBE_BASE_URLS_JSON` maps public region codes to internal
probe service origins. Non-loopback probe origins require HTTPS unless
`SELFHOST_EXECUTOR_ALLOW_INSECURE_PROBE_HTTP=true` explicitly marks an isolated,
trusted service network such as the default Compose bridge.

`SELFHOST_EXECUTOR_API_BASE_URL` also requires HTTPS outside loopback because
every request carries the internal Bearer secret. The default Compose bridge
sets `SELFHOST_EXECUTOR_ALLOW_INSECURE_API_HTTP=true` explicitly for its isolated
service network; leave that opt-in disabled for remote API origins.

`BROWSER_AUDIT_SHARED_SECRET` signs requests to the optional runner.
`SELFHOST_BROWSER_AUDIT_BASE_URL` enables that handler, and non-loopback HTTP
requires the separate
`SELFHOST_EXECUTOR_ALLOW_INSECURE_BROWSER_AUDIT_HTTP=true` trusted-network
opt-in.

Webhook targets require HTTPS by default because alert bodies and optional
signatures otherwise cross the network in cleartext. Legacy public HTTP
targets require `SELFHOST_EXECUTOR_ALLOW_INSECURE_WEBHOOK_HTTP=true`; this
opt-in does not relax public-address DNS pinning or the no-redirect policy.

`SELFHOST_EXECUTOR_MAX_EXECUTION_MS` defaults to 15 minutes. A timed-out
handler receives an abort signal and the execution is retried according to its
attempt policy.
