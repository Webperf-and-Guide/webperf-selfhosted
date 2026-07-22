import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { parseSelfhostExecutorVars } from '@webperf/config/selfhost-executor';
import { createExecutorApiClient } from './client';
import { describeSafeError } from './diagnostics';
import { createDefaultLeaseOwner } from './identity';
import { createNetworkExecutionHandler, parseProbeBaseUrls } from './network-handler';
import { ExecutionFailure, runExecutor } from './runner';
import { createWebhookExecutionHandler } from './webhook-handler';

const main = async () => {
  const runtime = parseSelfhostExecutorVars({
    SELFHOST_EXECUTOR_API_BASE_URL: process.env.SELFHOST_EXECUTOR_API_BASE_URL,
    SELFHOST_INTERNAL_SECRET: process.env.SELFHOST_INTERNAL_SECRET,
    PROBE_SHARED_SECRET: process.env.PROBE_SHARED_SECRET,
    SELFHOST_PROBE_BASE_URLS_JSON: process.env.SELFHOST_PROBE_BASE_URLS_JSON,
    SELFHOST_EXECUTOR_ALLOW_INSECURE_PROBE_HTTP:
      process.env.SELFHOST_EXECUTOR_ALLOW_INSECURE_PROBE_HTTP,
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

  const client = createExecutorApiClient({
    baseUrl: runtime.SELFHOST_EXECUTOR_API_BASE_URL,
    internalSecret: runtime.SELFHOST_INTERNAL_SECRET
  });
  const networkHandler = createNetworkExecutionHandler({
    client,
    leaseOwner,
    probeSharedSecret: runtime.PROBE_SHARED_SECRET,
    probeBaseUrls: parseProbeBaseUrls(runtime.SELFHOST_PROBE_BASE_URLS_JSON, {
      allowInsecureHttp: runtime.SELFHOST_EXECUTOR_ALLOW_INSECURE_PROBE_HTTP
    }),
    allowInsecureProbeHttp: runtime.SELFHOST_EXECUTOR_ALLOW_INSECURE_PROBE_HTTP
  });
  const webhookHandler = createWebhookExecutionHandler({ client, leaseOwner });

  if (runtime.SELFHOST_EXECUTOR_ALLOW_INSECURE_PROBE_HTTP) {
    console.warn(JSON.stringify({
      service: 'webperf-executor',
      warning: 'insecure_probe_http_enabled'
    }));
  }

  try {
    await runExecutor({
      client,
      handler: async (executionJob, signal) => {
        if (executionJob.kind === 'network_probe') {
          await networkHandler(executionJob, signal);
          return;
        }

        if (executionJob.kind === 'webhook_delivery') {
          await webhookHandler(executionJob, signal);
          return;
        }

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
