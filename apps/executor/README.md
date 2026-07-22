# executor

Single-concurrency durable execution worker for self-hosted WebPerf.

The executor claims encrypted SQLite-backed work through the API's internal
authenticated transport, renews leases while a handler runs, and stops claiming
new work during graceful shutdown. Network probe, Browser Audit, and webhook
handlers are registered here rather than in the API or scheduler.

## Local run

```sh
bun run dev:executor
```

Copy environment values from `apps/executor/.env.example`. The internal secret
must match the API and scheduler value.
