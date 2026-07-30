export {};

/**
 * Runs the complete Bun self-host control surface in one container.
 *
 * The API owns the embedded scheduler. This supervisor starts the API first,
 * waits for it to become ready, and then starts the console and durable
 * executor. On shutdown the executor is stopped before the API so an active
 * lease can persist its terminal state.
 */

type Signal = 'SIGINT' | 'SIGTERM';
type ChildName = 'api' | 'console' | 'executor';
type Child = ReturnType<typeof Bun.spawn>;

const apiPort = parsePort(process.env.SELFHOST_API_PORT, 8788);
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const startupTimeoutMs = 300_000;
const startupPollMs = 250;

const children = new Map<ChildName, Child>();
let shutdownSignal: Signal | null = null;
let shutdownResolve: ((signal: Signal) => void) | undefined;
const shutdownRequested = new Promise<Signal>((resolve) => {
  shutdownResolve = resolve;
});

const emit = (event: string, detail: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({
    service: 'webperf-standalone',
    event,
    ...detail
  }));
};

const spawnChild = (
  name: ChildName,
  argv: string[],
  env: Record<string, string | undefined> = {}
) => {
  const child = Bun.spawn(argv, {
    stdio: ['inherit', 'inherit', 'inherit'],
    env: {
      ...process.env,
      ...env
    }
  });
  children.set(name, child);
  emit('child_started', { child: name, pid: child.pid });
  return child;
};

const signalChild = (name: ChildName, signal: Signal | 'SIGKILL') => {
  const child = children.get(name);
  if (!child || child.exitCode !== null) {
    return;
  }
  try {
    process.kill(child.pid, signal);
  } catch (error) {
    if (
      error instanceof Error
      && 'code' in error
      && error.code === 'ESRCH'
    ) {
      return;
    }
    throw error;
  }
};

const requestShutdown = (signal: Signal) => {
  if (shutdownSignal) {
    emit('forced_shutdown', { reason: 'second_signal', signal });
    for (const name of children.keys()) {
      signalChild(name, 'SIGKILL');
    }
    process.exit(1);
  }
  shutdownSignal = signal;
  emit('shutdown_requested', { signal });
  shutdownResolve?.(signal);
};

const onSigint = () => requestShutdown('SIGINT');
const onSigterm = () => requestShutdown('SIGTERM');
process.on('SIGINT', onSigint);
process.on('SIGTERM', onSigterm);

const api = spawnChild(
  'api',
  ['bun', './apps/api/src/index.ts'],
  {
    SELFHOST_API_HOST: process.env.SELFHOST_API_HOST?.trim() || '0.0.0.0',
    SELFHOST_API_PORT: String(apiPort),
    SELFHOST_SCHEDULER_MODE: process.env.SELFHOST_SCHEDULER_MODE?.trim() || 'embedded',
    SELFHOST_SCHEDULER_API_BASE_URL: apiOrigin
  }
);

try {
  await waitForApi(api, `${apiOrigin}/health`);

  const consoleChild = spawnChild(
    'console',
    ['bun', './apps/console/build/index.js'],
    { CONTROL_BASE_URL: apiOrigin }
  );
  const executor = spawnChild(
    'executor',
    ['bun', './apps/executor/src/index.ts'],
    { SELFHOST_EXECUTOR_API_BASE_URL: apiOrigin }
  );

  emit('ready', { apiOrigin });

  const terminalEvent = await Promise.race([
    shutdownRequested.then((signal) => ({ type: 'signal' as const, signal })),
    api.exited.then((code) => ({ type: 'child' as const, name: 'api' as const, code })),
    consoleChild.exited.then((code) => ({
      type: 'child' as const,
      name: 'console' as const,
      code
    })),
    executor.exited.then((code) => ({
      type: 'child' as const,
      name: 'executor' as const,
      code
    }))
  ]);

  if (terminalEvent.type === 'child') {
    emit('child_exited', {
      child: terminalEvent.name,
      code: terminalEvent.code,
      unexpected: true
    });
  }

  await stopStandalone();
  process.exit(terminalEvent.type === 'signal' ? 0 : normalizeUnexpectedExit(terminalEvent.code));
} catch (error) {
  emit('startup_failed', {
    reason: error instanceof Error ? error.message : 'unknown startup failure'
  });
  await stopStandalone();
  process.exit(1);
}

async function waitForApi(apiChild: Child, healthUrl: string) {
  const deadline = Date.now() + startupTimeoutMs;

  while (Date.now() < deadline) {
    if (shutdownSignal) {
      throw new Error('shutdown requested during startup');
    }
    if (apiChild.exitCode !== null) {
      throw new Error(`API exited before readiness with code ${apiChild.exitCode}`);
    }

    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(2_000)
      });
      if (response.ok) {
        await response.body?.cancel();
        return;
      }
      await response.body?.cancel();
    } catch {
      // The API may not have bound its socket yet.
    }

    await Bun.sleep(startupPollMs);
  }

  throw new Error(`API did not become ready within ${startupTimeoutMs}ms`);
}

async function stopStandalone() {
  // Stop ingress and claiming first. The API remains available while the
  // executor aborts or records its active lease outcome.
  signalChild('console', 'SIGTERM');
  signalChild('executor', 'SIGTERM');
  await Promise.all([
    observeExit('console'),
    observeExit('executor')
  ]);

  signalChild('api', 'SIGTERM');
  await observeExit('api');
  emit('stopped');
}

async function observeExit(name: ChildName) {
  const child = children.get(name);
  if (!child) {
    return;
  }
  const code = await child.exited;
  emit('child_stopped', { child: name, code });
}

function parsePort(raw: string | undefined, fallback: number) {
  const value = raw?.trim() || String(fallback);
  if (!/^\d{1,5}$/.test(value)) {
    throw new Error('SELFHOST_API_PORT must be an integer between 1 and 65535');
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('SELFHOST_API_PORT must be an integer between 1 and 65535');
  }
  return parsed;
}

function normalizeUnexpectedExit(code: number) {
  if (code === 0) {
    return 1;
  }
  return code < 0 ? 128 + Math.abs(code) : code;
}
