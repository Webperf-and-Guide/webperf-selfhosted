# Runtime metrics

WebPerf exposes one provider-neutral JSON snapshot for self-host operators:

```http
GET /v1/runtime-metrics
Authorization: Bearer <token>
```

Use `SELFHOST_ADMIN_TOKEN`. The endpoint is protected and returns
`Cache-Control: no-store`. Do not put credentials in a query string or
monitoring URL.

## Snapshot fields

The v1 response contains:

- `observedAt` and the fixed `runtimeLocation`;
- `executions.ready`: work an executor can claim now, including reclaimable
  expired leases that still have attempts left;
- `executions.delayed`: queued retries or work whose `availableAt` is in the
  future;
- `executions.active`: live leased or running work;
- `executions.expiredLeases`: leased/running rows whose lease has expired;
- `executions.retryQueued`: queued rows that have already consumed an attempt;
- `executions.exhausted`: due or expired work that has no attempts left and
  will be finalized as failed by the next claim pass;
- oldest ready/active ages in milliseconds;
- retained counts by execution status and kind;
- the current execution topology and concurrency safety boundary.

Terminal status counts are not lifetime monotonic counters. They cover only
rows still present under the configured retention period, reported as
`retention.terminalCountsBoundedDays`.

Example:

```json
{
  "schemaVersion": 1,
  "observedAt": "2026-07-30T06:00:00.000Z",
  "runtimeLocation": {
    "regionId": "tokyo",
    "label": "Tokyo"
  },
  "executions": {
    "ready": 3,
    "delayed": 1,
    "active": 1,
    "expiredLeases": 0,
    "retryQueued": 1,
    "exhausted": 0,
    "oldestReadyAgeMs": 2400,
    "oldestActiveAgeMs": 800,
    "byStatus": {
      "queued": 4,
      "leased": 0,
      "running": 1,
      "succeeded": 120,
      "failed": 2,
      "cancelled": 0
    },
    "byKind": {
      "network_probe": {
        "queued": 4,
        "leased": 0,
        "running": 1,
        "succeeded": 120,
        "failed": 2,
        "cancelled": 0
      },
      "browser_audit": {
        "queued": 0,
        "leased": 0,
        "running": 0,
        "succeeded": 0,
        "failed": 0,
        "cancelled": 0
      },
      "webhook_delivery": {
        "queued": 0,
        "leased": 0,
        "running": 0,
        "succeeded": 0,
        "failed": 0,
        "cancelled": 0
      }
    }
  },
  "capacity": {
    "topology": "single-replica-sqlite",
    "executorConcurrency": 1,
    "horizontalScalingSafe": false
  },
  "retention": {
    "terminalCountsBoundedDays": 30
  }
}
```

## How to use the snapshot

Scrape every 15–30 seconds and retain observations in the monitoring system of
your choice. Alert on trends rather than one sample:

- `ready > 0` with a steadily increasing `oldestReadyAgeMs` means the executor
  is not draining work fast enough;
- a persistent `active = 1` plus growing ready work indicates saturation of
  the current single-concurrency executor;
- any sustained `expiredLeases` suggests executor failure, an execution timeout,
  or an undersized lease;
- `exhausted > 0` means the finalization pass is lagging or the executor is not
  claiming work;
- compare failed and succeeded retained counts as deltas between snapshots,
  not as an unbounded counter ratio.

The endpoint intentionally does not prescribe infrastructure thresholds.
A standalone operator can transform the JSON into Prometheus, OpenTelemetry,
or another local format.

## Horizontal scaling boundary

The self-hosted application uses one SQLite database and one executor process.
Starting independent application replicas without shared storage and lease
coordination creates divergent databases, so the API reports
`horizontalScalingSafe: false`.

Use growing backlog to decide when to:

1. stagger schedules or reduce batch bursts;
2. increase the runtime's CPU/memory allocation if platform data shows
   resource pressure;
3. design a shared-state protocol before enabling horizontal replicas.

Do not configure an orchestrator to autoscale the full self-hosted application
above one replica based only on the JSON metrics.
