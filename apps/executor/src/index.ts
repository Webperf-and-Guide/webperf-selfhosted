import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { parseSelfhostExecutorVars } from '@webperf/config/selfhost-executor';
import { createExecutorApiClient } from './client';
import { describeSafeError } from './diagnostics';
import { createDefaultLeaseOwner } from './identity';
import { ExecutionFailure, runExecutor } from './runner';

const main = async () => {
  const runtime = parseSelfhostExecutorVars({
    SELFHOST_EXECUTOR_API_BASE_URL: process.env.SELFHOST_EXECUTOR_API_BASE_URL,
    SELFHOST_INTERNAL_SECRET: process.env.SELFHOST_INTERNAL_SECRET,
    SELFHOST_EXECUTOR_ID: process.env.SELFHOST_EXECUTOR_ID,
    SELFHOST_EXECUTOR_POLL_INTERVAL_MS: process.env.SELFHOST_EXECUTOR_POLL_INTERVAL_MS,
    SELFHOST_EXECUTOR_LEASE_DURATION_MS: process.env.SELFHOST_EXECUTOR_LEASE_DURATION_MS,
    SELFHOST_EXECUTOR_HEARTBEAT_INTERVAL_MS: process.env.SELFHOST_EXECUTOR_HEARTBEAT_INTERVAL_MS,
    SELFHOST_EXECUTOR_MAX_EXECUTION_MS: process.env.SELFHOST_EXECUTOR_MAX_EXECUTION_MS
  });
  const leaseOwner = runtime.SELFHOST_EXECUTOR_ID
    ?? createDefaultLeaseOwner({
      host: hostname(),
      processId: process.pid,
      nonce: randomUUID()
    });
  const shutdownController = new AbortController();
  const requestShutdown = (signal: NodeJS.Signals) => {
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
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, requestShutdown);
  }

  console.log(
    JSON.stringify({
      service: 'webperf-executor',
      event: 'started',
      leaseOwner,
      apiBaseUrl: runtime.SELFHOST_EXECUTOR_API_BASE_URL
    })
  );

  try {
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
      maxExecutionMs: runtime.SELFHOST_EXECUTOR_MAX_EXECUTION_MS,
      pollIntervalMs: runtime.SELFHOST_EXECUTOR_POLL_INTERVAL_MS,
      signal: shutdownController.signal
    });
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.off(signal, requestShutdown);
    }
  }

  console.log(JSON.stringify({ service: 'webperf-executor', event: 'stopped' }));
};

try {
  await main();
} catch (error) {
  const incidentId = randomUUID();
  console.error(
    JSON.stringify({
      service: 'webperf-executor',
      event: 'fatal_error',
      incidentId,
      ...describeSafeError(error)
    })
  );
  process.exitCode = 1;
}
