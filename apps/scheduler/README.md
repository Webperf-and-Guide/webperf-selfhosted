# scheduler

Thin polling worker for scheduled self-host checks.

It makes one internal-token-authenticated `POST /v1/scheduler/dispatch` request
on a fixed interval. The API selects due Checks and creates queued Runs; this
process never claims execution work, calls probes, runs Browser Audits, or
delivers webhooks. Responses are contract-validated and error bodies are not
reflected into logs. Each dispatch is bounded to 30 seconds, and consecutive
failures use exponential backoff capped at the larger of 15 minutes or twice
the configured poll interval, with an absolute 48-hour ceiling.

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
