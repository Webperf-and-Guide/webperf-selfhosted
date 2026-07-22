import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { parseSelfhostExecutorVars } from '@webperf/config/selfhost-executor';
import { createExecutorApiClient } from './client';
import { ExecutionFailure, runExecutor } from './runner';

const runtime = parseSelfhostExecutorVars({
  SELFHOST_EXECUTOR_API_BASE_URL: process.env.SELFHOST_EXECUTOR_API_BASE_URL,
  SELFHOST_INTERNAL_SECRET: process.env.SELFHOST_INTERNAL_SECRET,
  SELFHOST_EXECUTOR_ID: process.env.SELFHOST_EXECUTOR_ID,
  SELFHOST_EXECUTOR_POLL_INTERVAL_MS: process.env.SELFHOST_EXECUTOR_POLL_INTERVAL_MS,
  SELFHOST_EXECUTOR_LEASE_DURATION_MS: process.env.SELFHOST_EXECUTOR_LEASE_DURATION_MS,
  SELFHOST_EXECUTOR_HEARTBEAT_INTERVAL_MS: process.env.SELFHOST_EXECUTOR_HEARTBEAT_INTERVAL_MS
});
const leaseOwner = runtime.SELFHOST_EXECUTOR_ID
  ?? `${hostname()}-${process.pid}-${randomUUID()}`;
const shutdownController = new AbortController();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (!shutdownController.signal.aborted) {
      console.log(
        JSON.stringify({
          service: 'webperf-executor',
          event: 'shutdown_requested',
          signal
        })
      );
      shutdownController.abort();
    }
  });
}

console.log(
  JSON.stringify({
    service: 'webperf-executor',
    event: 'started',
    leaseOwner,
    apiBaseUrl: runtime.SELFHOST_EXECUTOR_API_BASE_URL
  })
);

await runExecutor({
  client: createExecutorApiClient({
    baseUrl: runtime.SELFHOST_EXECUTOR_API_BASE_URL,
    internalSecret: runtime.SELFHOST_INTERNAL_SECRET
  }),
  handler: async (executionJob) => {
    throw new ExecutionFailure(
      'handler_unavailable',
      `No executor handler is registered for ${executionJob.kind}`,
      true,
      5_000
    );
  },
  leaseOwner,
  leaseDurationMs: runtime.SELFHOST_EXECUTOR_LEASE_DURATION_MS,
  heartbeatIntervalMs: runtime.SELFHOST_EXECUTOR_HEARTBEAT_INTERVAL_MS,
  pollIntervalMs: runtime.SELFHOST_EXECUTOR_POLL_INTERVAL_MS,
  signal: shutdownController.signal
});

console.log(JSON.stringify({ service: 'webperf-executor', event: 'stopped' }));
