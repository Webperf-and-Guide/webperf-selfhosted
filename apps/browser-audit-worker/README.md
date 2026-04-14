# Browser Audit Worker

Bun-first optional browser audit worker for `webperf-selfhosted`.

It runs:

- Bun runtime
- Chrome for Testing
- `puppeteer-core`
- Lighthouse user flows through the Lighthouse module API

The worker exposes:

- `GET /healthz`
- `GET /capabilities`
- `POST /audit`

## Local

```bash
bun run dev:browser-audit-worker
```

Useful environment variables:

- `PORT`
- `HOST`
- `CHROME_EXECUTABLE_PATH`
- `CHROME_INSTALL_DIR`
- `BROWSER_AUDIT_SHARED_SECRET`
- `BROWSER_AUDIT_SHARED_SECRET_NEXT`
- `BROWSER_AUDIT_ALLOW_NO_SANDBOX`

## Docker Build

```bash
docker build \
  -f apps/browser-audit-worker/Dockerfile \
  -t webperf-browser-audit-worker:dev \
  .
```

from the `webperf-selfhosted` repo root.
