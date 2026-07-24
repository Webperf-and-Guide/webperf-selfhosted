# Schedule saved Checks

Scheduling is interval-based. A saved Check can have an interval of five
minutes or more; the bundled scheduler polls the internal API every 60 seconds
by default and asks it to dispatch all due Checks.

## Enable a schedule

In **Checks**, edit a saved Check and set **Schedule interval minutes**. The API
stores `nextRunAt`, `lastRunAt`, and the number of jobs created by the last
scheduled dispatch. Clearing the interval disables future dispatch without
deleting Run history.

The scheduler does not execute probes itself. It only sends an authenticated
request to the API. The API atomically creates the scheduled Run and durable
execution jobs; the executor claims and processes those jobs.

## Timing behavior

- Timestamps are ISO UTC instants, not a local-time cron expression.
- Dispatch precision is bounded by `SELFHOST_SCHEDULER_POLL_INTERVAL_SECONDS`
  and normal processing delay.
- After a due Check is dispatched, its next time is the dispatch time plus its
  interval. The scheduler does not create a burst of historical catch-up Runs.
- Manual Runs do not replace the scheduler or erase the next due time.
- API or scheduler outages use capped backoff. Due Checks remain persisted and
  are considered again after recovery.

## Observe the scheduler

```sh
docker compose --env-file .env -f compose.yml logs --since=30m scheduler
docker compose --env-file .env -f compose.yml logs --since=30m executor
```

Successful scheduler logs report the dispatch time, triggered Check count, and
created job count without logging credentials or response bodies. In the
console, verify `lastRunAt`, `nextRunAt`, and the resulting scheduled Run.

## External dispatch

The bundled scheduler is the normal self-host path. An external private
automation system may call `POST /v1/scheduler/dispatch` with
`Authorization: Bearer <SELFHOST_INTERNAL_SECRET>`, but the endpoint must stay
behind a private network or additional gateway. Never publish it solely to
make a hosted cron service convenient.

The example in
[examples/github-actions/scheduler-dispatch.yml](../../examples/github-actions/scheduler-dispatch.yml)
requires both a private control URL and the internal secret. Prefer a
self-hosted runner on the same private network.
