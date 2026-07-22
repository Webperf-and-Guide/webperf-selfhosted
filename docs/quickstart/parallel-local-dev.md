# Parallel Local Dev

Use this path when the default WebPerf development ports are already occupied or
when two self-host configurations need to run on the same machine.

## Commands

```bash
bun run dev:parallel
bun run smoke:console:parallel
```

That keeps the default standalone ports unchanged while moving this instance to:

- console: `http://localhost:4174`
- probe: `http://127.0.0.1:8082`

## Override Environment Variables

Standalone OSS:

- `SELFHOST_CONSOLE_PORT`
- `SELFHOST_CONTROL_BASE_URL`
- `SELFHOST_PROBE_PORT`

Parallel OSS:

- `SELFHOST_PARALLEL_CONSOLE_PORT`
- `SELFHOST_PARALLEL_PROBE_PORT`
- `SELFHOST_PARALLEL_PROBE_BASE_URL`
- `SELFHOST_PARALLEL_PROBE_BASE_URLS_JSON`

The helper scripts preflight these ports before booting so collisions fail fast instead of half-starting the stack.

## Recommended Loop

1. start the alternate instance with `bun run dev:parallel`
2. start the other local service or WebPerf instance on its own ports
3. smoke this instance with `bun run smoke:console:parallel`

Use this path when validating shared package changes or comparing two independent
self-host configurations.
