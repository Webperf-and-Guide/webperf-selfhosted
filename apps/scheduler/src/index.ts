import { randomUUID } from 'node:crypto';
import { parseSelfhostSchedulerVars } from '@webperf/config/selfhost-scheduler';
import {
  describeSchedulerError,
  dispatchScheduledChecks,
  runScheduler,
  type SchedulerLogger
} from './scheduler';

const main = async () => {
  const runtime = parseSelfhostSchedulerVars({
    SELFHOST_SCHEDULER_API_BASE_URL: process.env.SELFHOST_SCHEDULER_API_BASE_URL,
    SELFHOST_INTERNAL_SECRET: process.env.SELFHOST_INTERNAL_SECRET,
    SELFHOST_SCHEDULER_POLL_INTERVAL_SECONDS:
      process.env.SELFHOST_SCHEDULER_POLL_INTERVAL_SECONDS
  });
  const shutdownController = new AbortController();
  const requestShutdown = (signal: NodeJS.Signals) => {
    if (!shutdownController.signal.aborted) {
      console.log(JSON.stringify({
        service: 'webperf-scheduler',
        event: 'shutdown_requested',
        signal
      }));
      shutdownController.abort(new Error('Scheduler shutdown requested'));
    }
  };
  const onSigint = () => requestShutdown('SIGINT');
  const onSigterm = () => requestShutdown('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);

  const logger: SchedulerLogger = {
    info: (event) => console.log(JSON.stringify({
      service: 'webperf-scheduler',
      level: 'info',
      ...event
    })),
    error: (event) => console.error(JSON.stringify({
      service: 'webperf-scheduler',
      level: 'error',
      ...event
    }))
  };

  logger.info({
    event: 'started',
    apiBaseUrl: runtime.SELFHOST_SCHEDULER_API_BASE_URL,
    pollIntervalSeconds: runtime.SELFHOST_SCHEDULER_POLL_INTERVAL_SECONDS
  });

  try {
    await runScheduler({
      dispatch: (signal) => dispatchScheduledChecks({
        apiBaseUrl: runtime.SELFHOST_SCHEDULER_API_BASE_URL,
        internalSecret: runtime.SELFHOST_INTERNAL_SECRET,
        signal
      }),
      pollIntervalMs: runtime.SELFHOST_SCHEDULER_POLL_INTERVAL_SECONDS * 1_000,
      signal: shutdownController.signal,
      logger
    });
  } finally {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
  }

  logger.info({ event: 'stopped' });
};

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    service: 'webperf-scheduler',
    event: 'fatal_error',
    incidentId: randomUUID(),
    ...describeSchedulerError(error)
  }));
  process.exitCode = 1;
}
