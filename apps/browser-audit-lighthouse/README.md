# Browser Audit Worker

Bun-first optional browser audit Lighthouse runner for `webperf-selfhosted`.

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
bun run dev:browser-audit-lighthouse
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
  -f apps/browser-audit-lighthouse/Dockerfile \
  -t webperf-browser-audit-lighthouse:dev \
  .
```

from the `webperf-selfhosted` repo root.
