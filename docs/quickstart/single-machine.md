# Single-Machine Quickstart

Use this contributor path when you want the fastest source-based trial on one
machine. Operators should use the tagged [install guide](../users/install.md).

## 1. Install Dependencies

```bash
bun install
```

## 2. Start The Default Stack

```bash
bun run dev
```

This boots:

- console
- API
- Rust probe
- scheduler
- executor

Default local URLs:

- console: `http://localhost:5173`
- API: `http://127.0.0.1:8788`
- probe: `http://127.0.0.1:8080`

## 3. Verify The Stack

```bash
curl http://127.0.0.1:8788/health
curl http://127.0.0.1:8080/healthz
bun run smoke:console
bun run capture:console:baselines
```

Use the console to:

1. launch a manual run
2. inspect live target results
3. define reusable sites, route groups, region sets, and checks
4. review reports and region coverage

## Optional Browser Audit

The browser-audit Lighthouse runner is optional and not part of the default `bun run dev` path.

Run the self-host stack with Browser Audit executor wiring:

```bash
BROWSER_AUDIT_SHARED_SECRET=dev-browser-audit-shared-secret \
SELFHOST_BROWSER_AUDIT_BASE_URL=http://127.0.0.1:8081 \
bun run dev
```

Run the worker in a second shell:

```bash
BROWSER_AUDIT_SHARED_SECRET=dev-browser-audit-shared-secret \
bun run dev:browser-audit-lighthouse
```

That enables:

- `GET /v1/browser-audits`
- `POST /v1/browser-audits`
- `GET /v1/browser-audits/:id`
- authenticated artifact downloads from the Browser Audit detail view

See [browser-audit-lighthouse.md](../self-hosting/browser-audit-lighthouse.md) for the runtime profile and current queued-execution limits.

## Notes

- This repo stays vendor-neutral. Platform-specific deployment walkthroughs live on `webperf.and.guide`.
- If you want a Docker-first install, use [local-compose.md](./local-compose.md).
- If you need alternate development ports, use [parallel-local-dev.md](./parallel-local-dev.md).
- `bun run capture:console:baselines` captures desktop and mobile screenshots for `/`, `/resources`, `/checks`, `/reports`, and `/regions` against the currently running console.
