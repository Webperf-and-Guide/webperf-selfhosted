# Run Browser Audits

Browser Audit is an optional, asynchronous extension to Fast Check. The public
protocol is engine-neutral; `apps/browser-audit-lighthouse` is the shipped
Lighthouse reference runner, not a requirement that every future engine use
Lighthouse-shaped contracts.

## Enable the Compose profile

Set the internal runner origin in `.env`:

```dotenv
SELFHOST_BROWSER_AUDIT_BASE_URL=http://browser-audit-lighthouse:8080
BROWSER_AUDIT_ALLOW_NO_SANDBOX=false
```

Keep the generated `BROWSER_AUDIT_SHARED_SECRET` identical for the executor
and runner, then start the optional profile:

```sh
docker compose --env-file .env --profile browser-audit -f compose.yml up -d
docker compose --env-file .env --profile browser-audit -f compose.yml ps
```

The runner remains on its dedicated internal network with no host port. The
production profile uses the image's setuid Chrome sandbox, a non-root runtime,
1 GiB of `/dev/shm`, writable temporary mounts, no default `SYS_ADMIN`, and one
in-flight audit per worker.

## Launch and inspect

Open **Reports → Browser audits**, enter a public target and policy, and submit.
The API returns a queued resource immediately. The durable executor claims the
job, calls the signed runner endpoint, persists status and normalized results,
and stores artifact bytes outside SQLite.

The resource can move through queued, running, succeeded, or failed states. A
restart does not require the browser to run inside the API process: expired
execution leases are reclaimed by a later executor attempt.

## Supported flows

Portable setup steps include viewport, cookies, and extra headers. Interactive
steps include navigation, selector or URL waits, clicks, typing, key presses,
selects, and bounded waits. Checkpoints support navigation, snapshots, and
timespan start/end.

The Lighthouse runner currently limits a flow to 20 steps, three checkpoints,
one page, one browser context, a default 120-second total timeout, and a
default 10-second step timeout. The contract normalizes core metrics, scores,
extended metrics, checkpoints, issues, artifacts, timestamps, and
engine/browser/runtime/component toolchain records.

See the [Browser Audit Protocol](../architecture/browser-audit-protocol.md) for
the versioned wire contract.

## Network and sandbox policy

Targets, redirects, navigations, and subresources must resolve to public HTTP
or HTTPS addresses. The runner blocks private/local/metadata networks,
non-HTTP schemes, downloads, and new windows. Exact hosts can be placed in
`BROWSER_AUDIT_HOST_ALLOWLIST`, but that is an explicit SSRF-policy exception
and should be used only on an isolated runner network.

Do not set `BROWSER_AUDIT_ALLOW_NO_SANDBOX=true` merely to make a host boot.
First enable user namespaces or preserve the image's root-owned mode-4755
`chrome-sandbox`. A no-sandbox runner is a degraded security mode and should
not share a host with sensitive workloads.

## Artifacts and failures

The standard registry includes Lighthouse JSON, Lighthouse HTML, full-page
screenshots, and traces, while the protocol permits safe extension kinds. The
runner receives only a short-lived, execution- and lease-bound upload grant;
it never receives the administrator or internal service credential.

Use [Artifacts](./artifacts.md) for storage and retention. For startup,
sandbox, timeout, or queued-job failures, use
[Troubleshooting](./troubleshooting.md) and the detailed
[runner notes](../self-hosting/browser-audit-lighthouse.md).
