export {};

/**
 * Phase 2 of issue #14: single-image role dispatcher.
 *
 * One `webperf` image ships every Bun app. This script reads `WEBPERF_ROLE`
 * (or `argv[2]`) and execs into the matching entrypoint, so the same image
 * runs as the complete standalone control surface, one split service role, or
 * a one-off db command without a separate image per role.
 *
 * Usage in Compose:
 *   environment:
 *     WEBPERF_ROLE: standalone
 *
 * Or as a command override:
 *   command: ["bun", "run", "tooling/scripts/webperf-role.ts", "api"]
 */

const ROLE_ENTRYPOINTS: Record<string, string[]> = {
  standalone: ['bun', './tooling/scripts/webperf-standalone.ts'],
  console: ['bun', './apps/console/build/index.js'],
  api: ['bun', './apps/api/src/index.ts'],
  executor: ['bun', './apps/executor/src/index.ts'],
  scheduler: ['bun', './apps/scheduler/src/index.ts'],
  // db is a passthrough to selfhost-database.ts; extra argv becomes the
  // subcommand (migrate, backup, restore, doctor, maintenance, optimize).
  db: ['bun', './tooling/scripts/selfhost-database.ts']
};

const resolveRole = (): string => {
  const fromEnv = process.env.WEBPERF_ROLE?.trim().toLowerCase();
  if (fromEnv && fromEnv in ROLE_ENTRYPOINTS) {
    return fromEnv;
  }

  const fromArgv = process.argv[2]?.trim().toLowerCase();
  if (fromArgv && fromArgv in ROLE_ENTRYPOINTS) {
    return fromArgv;
  }

  throw new Error(
    `WEBPERF_ROLE must be one of: ${Object.keys(ROLE_ENTRYPOINTS).join(', ')}. `
    + 'Set the WEBPERF_ROLE environment variable or pass it as the first argument.'
  );
};

const role = resolveRole();
const entrypoint = ROLE_ENTRYPOINTS[role];

// Determine which argv position holds the role and which holds extra args.
// When the role comes from WEBPERF_ROLE env var, argv[2] is the first extra
// arg (e.g. `docker run -e WEBPERF_ROLE=db <image> backup`). When the role
// comes from argv[2], extra args start at argv[3].
const roleFromEnv = Boolean(process.env.WEBPERF_ROLE?.trim());
const extraArgs = process.argv.slice(roleFromEnv ? 2 : 3);
if (extraArgs.length > 0 && role !== 'db') {
  throw new Error(
    `Role '${role}' does not accept extra arguments, but received: ${extraArgs.join(' ')}`
  );
}
const finalArgv = [...entrypoint, ...extraArgs];

console.log(JSON.stringify({
  service: 'webperf',
  event: 'role_selected',
  role,
  entrypoint: finalArgv.join(' ')
}));

// Use Bun.spawn with stdio inheritance so the child process replaces this
// dispatcher as the effective PID 1 for signal handling.
const child = Bun.spawn(finalArgv, {
  stdio: ['inherit', 'inherit', 'inherit'],
  env: process.env
});

// Forward signals to the child so container stop works correctly.
const forwardSignal = (signal: NodeJS.Signals) => {
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

process.once('SIGINT', forwardSignal);
process.once('SIGTERM', forwardSignal);

// Bun's child.exited returns the exit code for normal termination, or a
// negative value (the negated signal number) if the child was killed by a
// signal. Convert to the POSIX 128+signal convention so orchestrators
// (Docker, Kubernetes) classify the exit correctly.
const rawExitCode = await child.exited;
const exitCode = rawExitCode < 0 ? 128 + Math.abs(rawExitCode) : rawExitCode;
process.exit(exitCode);
