import { parseSelfhostSchedulerVars } from '@webperf/config/selfhost-scheduler';

const runtime = parseSelfhostSchedulerVars({
  SELFHOST_SCHEDULER_API_BASE_URL: process.env.SELFHOST_SCHEDULER_API_BASE_URL,
  SELFHOST_SCHEDULER_POLL_INTERVAL_SECONDS: process.env.SELFHOST_SCHEDULER_POLL_INTERVAL_SECONDS
});
const pollIntervalMs = runtime.SELFHOST_SCHEDULER_POLL_INTERVAL_SECONDS * 1000;

let shuttingDown = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function dispatchScheduledChecks() {
  const dispatchUrl = new URL('/v1/scheduler/dispatch', runtime.SELFHOST_SCHEDULER_API_BASE_URL);
  const startedAt = new Date().toISOString();
  const response = await fetch(dispatchUrl, { method: 'POST' });
  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(`scheduler dispatch failed (${response.status}): ${bodyText}`);
  }

  const payload = bodyText.length > 0 ? JSON.parse(bodyText) : {};
  const triggeredProfiles = Array.isArray(payload.triggeredProfiles) ? payload.triggeredProfiles : [];
  const createdJobs = triggeredProfiles.reduce(
    (count: number, profile: { jobIds?: unknown }) =>
      count + (Array.isArray(profile.jobIds) ? profile.jobIds.length : 0),
    0
  );
  console.log(
    `[scheduler] ${startedAt} dispatched ${payload.triggeredCount ?? 0} profile(s), created ${createdJobs} job(s)`
  );
}

async function main() {
  console.log(
    `[scheduler] polling ${runtime.SELFHOST_SCHEDULER_API_BASE_URL} every ${runtime.SELFHOST_SCHEDULER_POLL_INTERVAL_SECONDS}s`
  );

  while (!shuttingDown) {
    try {
      await dispatchScheduledChecks();
    } catch (error) {
      console.error(
        `[scheduler] dispatch failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    if (shuttingDown) {
      break;
    }

    await sleep(pollIntervalMs);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    shuttingDown = true;
    console.log(`[scheduler] received ${signal}, stopping after current cycle`);
  });
}

await main();
