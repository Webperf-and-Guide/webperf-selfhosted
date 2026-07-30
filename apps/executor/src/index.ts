import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { parseSelfhostExecutorVars } from '@webperf/config/selfhost-executor';
import { startProcessHeartbeat } from '@webperf/config/selfhost-process-heartbeat';
import { createBrowserAuditExecutionHandler } from './browser-audit-handler';
import { createExecutorApiClient } from './client';
import { describeSafeError } from './diagnostics';
import { createDefaultLeaseOwner } from './identity';
import { createNetworkExecutionHandler, parseProbeBaseUrl } from './network-handler';
import { ExecutionFailure, runExecutor } from './runner';
import { createWebhookExecutionHandler } from './webhook-handler';

const defaultProcessHeartbeatPath = '/tmp/webperf-executor-heartbeat';
const forcedShutdownTimeoutMs = 10_000;
type ExecutorShutdownReason = NodeJS.Signals | 'unhandledRejection' | 'uncaughtException';
let requestActiveShutdown: ((reason: ExecutorShutdownReason) => void) | undefined;

const main = async () => {
  const runtime = parseSelfhostExecutorVars({
    SELFHOST_EXECUTOR_API_BASE_URL: process.env.SELFHOST_EXECUTOR_API_BASE_URL,
    SELFHOST_EXECUTOR_ALLOW_INSECURE_API_HTTP:
      process.env.SELFHOST_EXECUTOR_ALLOW_INSECURE_API_HTTP,
    SELFHOST_INTERNAL_SECRET: process.env.SELFHOST_INTERNAL_SECRET,
    PROBE_SHARED_SECRET: process.env.PROBE_SHARED_SECRET,
    BROWSER_AUDIT_SHARED_SECRET: process.env.BROWSER_AUDIT_SHARED_SECRET,
    SELFHOST_PROBE_BASE_URL: process.env.SELFHOST_PROBE_BASE_URL,
    SELFHOST_BROWSER_AUDIT_BASE_URL: process.env.SELFHOST_BROWSER_AUDIT_BASE_URL,
    SELFHOST_EXECUTOR_ALLOW_INSECURE_PROBE_HTTP:
      process.env.SELFHOST_EXECUTOR_ALLOW_INSECURE_PROBE_HTTP,
    SELFHOST_EXECUTOR_ALLOW_INSECURE_BROWSER_AUDIT_HTTP:
      process.env.SELFHOST_EXECUTOR_ALLOW_INSECURE_BROWSER_AUDIT_HTTP,
    SELFHOST_EXECUTOR_ALLOW_INSECURE_WEBHOOK_HTTP:
      process.env.SELFHOST_EXECUTOR_ALLOW_INSECURE_WEBHOOK_HTTP,
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
  let forcedShutdownTimer: ReturnType<typeof setTimeout> | null = null;
  const requestShutdown = (reason: ExecutorShutdownReason) => {
    if (shutdownController.signal.aborted) {
      if (reason === 'SIGINT' || reason === 'SIGTERM') {
        console.error(JSON.stringify({
          service: 'webperf-executor',
          event: 'forced_shutdown',
          reason: 'second_signal'
        }));
        process.exit(1);
      }
      return;
    }
    console.log(
      JSON.stringify({
        service: 'webperf-executor',
        event: 'shutdown_requested',
        reason,
        ...(reason === 'SIGINT' || reason === 'SIGTERM' ? { signal: reason } : {})
      })
    );
    shutdownController.abort();
    forcedShutdownTimer = setTimeout(() => {
      console.error(JSON.stringify({
        service: 'webperf-executor',
        event: 'forced_shutdown',
        reason: 'grace_timeout',
        timeoutMs: forcedShutdownTimeoutMs
      }));
      process.exit(1);
    }, forcedShutdownTimeoutMs);
    forcedShutdownTimer.unref?.();
  };

  const onSigint = () => requestShutdown('SIGINT');
  const onSigterm = () => requestShutdown('SIGTERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
  requestActiveShutdown = requestShutdown;

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
    internalSecret: runtime.SELFHOST_INTERNAL_SECRET,
    allowInsecureHttp: runtime.SELFHOST_EXECUTOR_ALLOW_INSECURE_API_HTTP
  });
  const networkHandler = createNetworkExecutionHandler({
    client,
    leaseOwner,
    probeSharedSecret: runtime.PROBE_SHARED_SECRET,
    probeBaseUrl: parseProbeBaseUrl(runtime.SELFHOST_PROBE_BASE_URL, {
      allowInsecureHttp: runtime.SELFHOST_EXECUTOR_ALLOW_INSECURE_PROBE_HTTP
    }),
    allowInsecureProbeHttp: runtime.SELFHOST_EXECUTOR_ALLOW_INSECURE_PROBE_HTTP
  });
  const webhookHandler = createWebhookExecutionHandler({
    client,
    leaseOwner,
    allowInsecureHttp: runtime.SELFHOST_EXECUTOR_ALLOW_INSECURE_WEBHOOK_HTTP
  });
  const browserAuditHandler = createBrowserAuditExecutionHandler({
    client,
    leaseOwner,
    browserAuditSharedSecret: runtime.BROWSER_AUDIT_SHARED_SECRET,
    browserAuditBaseUrl: runtime.SELFHOST_BROWSER_AUDIT_BASE_URL,
    allowInsecureBrowserAuditHttp:
      runtime.SELFHOST_EXECUTOR_ALLOW_INSECURE_BROWSER_AUDIT_HTTP
  });

  if (runtime.SELFHOST_EXECUTOR_ALLOW_INSECURE_PROBE_HTTP) {
    console.warn(JSON.stringify({
      service: 'webperf-executor',
      warning: 'insecure_probe_http_enabled'
    }));
  }

  if (
    runtime.SELFHOST_EXECUTOR_ALLOW_INSECURE_API_HTTP
    && new URL(runtime.SELFHOST_EXECUTOR_API_BASE_URL).protocol === 'http:'
  ) {
    console.warn(JSON.stringify({
      service: 'webperf-executor',
      warning: 'insecure_executor_api_http_enabled'
    }));
  }

  if (
    runtime.SELFHOST_BROWSER_AUDIT_BASE_URL
    && runtime.SELFHOST_EXECUTOR_ALLOW_INSECURE_BROWSER_AUDIT_HTTP
    && new URL(runtime.SELFHOST_BROWSER_AUDIT_BASE_URL).protocol === 'http:'
  ) {
    console.warn(JSON.stringify({
      service: 'webperf-executor',
      warning: 'insecure_browser_audit_http_enabled'
    }));
  }

  if (runtime.SELFHOST_EXECUTOR_ALLOW_INSECURE_WEBHOOK_HTTP) {
    console.warn(JSON.stringify({
      service: 'webperf-executor',
      warning: 'insecure_webhook_http_enabled'
    }));
  }

  const stopProcessHeartbeat = await startProcessHeartbeat({
    heartbeatPath:
      process.env.WEBPERF_PROCESS_HEARTBEAT_PATH?.trim() || defaultProcessHeartbeatPath,
    onWriteFailure: () => console.error(JSON.stringify({
      service: 'webperf-executor',
      event: 'process_heartbeat_write_failed'
    }))
  });

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

        if (executionJob.kind === 'browser_audit') {
          await browserAuditHandler(executionJob, signal);
          return;
        }

        throw new ExecutionFailure(
          'handler_unavailable',
          `No executor handler is registered for ${executionJob.kind}`,
          false
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
    stopProcessHeartbeat();
    if (forcedShutdownTimer) {
      clearTimeout(forcedShutdownTimer);
      forcedShutdownTimer = null;
    }
    requestActiveShutdown = undefined;
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
  }

  console.log(JSON.stringify({ service: 'webperf-executor', event: 'stopped' }));
};

let fatalErrorReported = false;
const reportFatalError = (
  source: 'main' | 'unhandledRejection' | 'uncaughtException',
  error: unknown
) => {
  if (fatalErrorReported) {
    console.error(
      JSON.stringify({
        service: 'webperf-executor',
        event: 'critical_event_during_shutdown',
        source,
        ...describeSafeError(error)
      })
    );
    return;
  }
  fatalErrorReported = true;
  const incidentId = randomUUID();
  console.error(
    JSON.stringify({
      service: 'webperf-executor',
      event: 'fatal_error',
      incidentId,
      source,
      ...describeSafeError(error)
    })
  );
  process.exitCode = 1;
  if (source !== 'main') {
    if (requestActiveShutdown) {
      requestActiveShutdown(source);
    } else {
      console.error(JSON.stringify({
        service: 'webperf-executor',
        event: 'forced_shutdown',
        reason: 'shutdown_not_ready'
      }));
      process.exit(1);
    }
  }
};
const onUnhandledRejection = (reason: unknown) => {
  reportFatalError('unhandledRejection', reason);
};
const onUncaughtException = (error: Error) => {
  reportFatalError('uncaughtException', error);
};
process.on('unhandledRejection', onUnhandledRejection);
process.on('uncaughtException', onUncaughtException);

try {
  await main();
} catch (error) {
  reportFatalError('main', error);
} finally {
  process.off('unhandledRejection', onUnhandledRejection);
  process.off('uncaughtException', onUncaughtException);
}
