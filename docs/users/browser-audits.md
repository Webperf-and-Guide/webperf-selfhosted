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
and runner. Ubuntu 24.04 and other AppArmor 4 hosts restrict unprivileged user
namespaces even inside Docker's default profile. Install the release-bundled
WebPerf profile once so AppArmor reloads it after reboot:

```sh
sudo install -o root -g root -m 0644 browser-audit.apparmor \
  /etc/apparmor.d/webperf-browser-audit
sudo apparmor_parser -r -W /etc/apparmor.d/webperf-browser-audit
```

On those hosts, start the optional profile with the AppArmor Compose overlay:

```sh
docker compose --env-file .env --profile browser-audit \
  -f compose.yml -f compose.apparmor.yml up -d
docker compose --env-file .env --profile browser-audit \
  -f compose.yml -f compose.apparmor.yml ps
```

Omit `compose.apparmor.yml` on hosts that do not enforce AppArmor
user-namespace restrictions.

The runner remains on its dedicated internal network with no host port. The
production profile uses Chromium's user-namespace sandbox, a non-root runtime,
`no-new-privileges`, non-executable temporary mounts, 1 GiB of `/dev/shm`, no
default `SYS_ADMIN`, and one in-flight audit per worker. Compose drops all Linux
capabilities and restores only `SYS_CHROOT`, which Chromium needs to enter its
sandbox root. Packaged setuid helpers are kept non-setuid and the runner
explicitly disables the setuid sandbox path; do not replace that policy with
`--no-sandbox` in a production deployment. The AppArmor overlay follows
Chromium's AppArmor 4 guidance: it selects an unconfined profile with the
explicit `userns` permission only for this service instead of disabling the
host restriction globally. The container remains bounded by its default-deny
seccomp policy, no-new-privileges, read-only filesystem, private network, and
Chromium's own sandbox.
The amd64 image pins its exact Chrome for Testing revision in the Dockerfile,
keeps it aligned with the locked `puppeteer-core` package, and never follows
the mutable `stable` channel.

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
default 10-second step timeout. The total deadline includes every interactive
step plus report and artifact finalization, and an explicit wait may not exceed
the per-step timeout. Key-press values are engine-specific; the Lighthouse runner
rejects values outside its pinned Puppeteer keyboard layout. The contract
normalizes core metrics, scores,
extended metrics, checkpoints, issues, artifacts, timestamps, and
engine/browser/runtime/component toolchain records.

See the [Browser Audit Protocol](../architecture/browser-audit-protocol.md) for
the versioned wire contract.

## Network and sandbox policy

Targets, redirects, navigations, and subresources must resolve to public HTTP
or HTTPS addresses. The runner blocks private/local/metadata networks,
non-HTTP schemes, downloads, and new windows. A loopback-only proxy pins each
validated DNS answer for the actual browser connection. Exact hosts can be
placed in `BROWSER_AUDIT_HOST_ALLOWLIST`; private answers for those hosts are
an explicit SSRF-policy exception, remain DNS-pinned, and should be used only
on an isolated runner network.

Do not set `BROWSER_AUDIT_ALLOW_NO_SANDBOX=true` merely to make a host boot.
First load the bundled AppArmor profile when the host restricts unprivileged
user namespaces. Do not disable that restriction globally. A no-sandbox runner
is a degraded security mode and should not share a host with sensitive
workloads.

## Artifacts and failures

The standard registry includes Lighthouse JSON, Lighthouse HTML, full-page
screenshots, and traces, while the protocol permits safe extension kinds. The
runner receives only a short-lived, execution- and lease-bound upload grant;
it never receives the administrator or internal service credential.

Use [Artifacts](./artifacts.md) for storage and retention. For startup,
sandbox, timeout, or queued-job failures, use
[Troubleshooting](./troubleshooting.md) and the detailed
[runner notes](../self-hosting/browser-audit-lighthouse.md).
