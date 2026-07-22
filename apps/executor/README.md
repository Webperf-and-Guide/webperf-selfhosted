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

`BROWSER_AUDIT_SHARED_SECRET` signs requests to the optional runner.
`SELFHOST_BROWSER_AUDIT_BASE_URL` enables that handler, and non-loopback HTTP
requires the separate
`SELFHOST_EXECUTOR_ALLOW_INSECURE_BROWSER_AUDIT_HTTP=true` trusted-network
opt-in.

`SELFHOST_EXECUTOR_MAX_EXECUTION_MS` defaults to 15 minutes. A timed-out
handler receives an abort signal and the execution is retried according to its
attempt policy.
