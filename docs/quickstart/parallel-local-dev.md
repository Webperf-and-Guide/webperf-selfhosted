# Parallel Local Dev

Use this path when `webperf-selfhosted` and `webperf.and.guide` need to run on the same machine.

## Supported OSS Commands

```bash
bun run dev:parallel:cloud
bun run smoke:console:parallel:cloud
```

That keeps the default standalone ports unchanged while moving the self-host parallel path to:

- console: `http://localhost:4174`
- probe: `http://127.0.0.1:8082`

The managed repo keeps its Bunny-local stack on the usual probe/browser-audit/edge ports and moves only the cloud console:

- cloud console: `http://localhost:4175`

## Supported Cloud Pairing

In `webperf.and.guide`:

```bash
bun run dev:parallel:selfhost
bun run smoke:console:parallel:selfhost
```

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

## Recommended Pairing Loop

1. start `webperf-selfhosted` with `bun run dev:parallel:cloud`
2. start `webperf.and.guide` with `bun run dev:parallel:selfhost`
3. smoke OSS with `bun run smoke:console:parallel:cloud`
4. smoke cloud with `bun run smoke:console:parallel:selfhost`

Use this path when you are validating shared UI changes, shared contracts, or boundary behavior across both repos.
