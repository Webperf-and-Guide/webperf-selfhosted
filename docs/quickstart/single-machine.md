# Single-Machine Quickstart

Use this path when you want the fastest possible self-host trial on one machine.

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

## Optional Browser Audit Direct-Run

The browser-audit worker is optional and not part of the default `bun run dev` path.

Run the API with browser-audit wiring:

```bash
BROWSER_AUDIT_SHARED_SECRET=dev-browser-audit-shared-secret \
SELFHOST_BROWSER_AUDIT_BASE_URL=http://127.0.0.1:8081 \
bun run dev:api
```

Run the worker in a second shell:

```bash
BROWSER_AUDIT_SHARED_SECRET=dev-browser-audit-shared-secret \
bun run dev:browser-audit-worker
```

That enables:

- `GET /v1/browser-audits`
- `POST /v1/browser-audits`
- `GET /v1/browser-audits/:id`

See [browser-audit-worker.md](/Users/imjlk/repos/and-guide/webperf-selfhosted/docs/self-hosting/browser-audit-worker.md) for the runtime profile and current direct-run limits.

## Notes

- This repo stays vendor-neutral. Platform-specific deployment walkthroughs live on `webperf.and.guide`.
- If you want a Docker-first install, use [local-compose.md](/Users/imjlk/repos/and-guide/webperf-selfhosted/docs/quickstart/local-compose.md).
- If you want to run OSS and cloud locally side-by-side, use [parallel-local-dev.md](/Users/imjlk/repos/and-guide/webperf-selfhosted/docs/quickstart/parallel-local-dev.md).
- `bun run capture:console:baselines` captures desktop and mobile screenshots for `/`, `/resources`, `/checks`, `/reports`, and `/regions` against the currently running console.
