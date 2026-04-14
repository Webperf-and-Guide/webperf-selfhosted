# scheduler

Thin polling worker for scheduled self-host checks.

It calls the self-host API dispatch endpoint on a fixed interval and does not
introduce queues, tenancy, or managed orchestration assumptions.

## Local Run

```sh
bun run dev:scheduler
```

## Environment

Copy values from:

```text
apps/scheduler/.env.example
```

Useful defaults:

- `SELFHOST_SCHEDULER_API_BASE_URL=http://127.0.0.1:8788`
- `SELFHOST_SCHEDULER_POLL_INTERVAL_SECONDS=60`
