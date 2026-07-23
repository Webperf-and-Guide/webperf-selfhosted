# Troubleshooting

Start with Compose state and bounded service logs. Do not paste `.env`, request
headers, cookies, signed payloads, or database files into an issue.

```sh
docker compose --env-file .env -f compose.yml config --quiet
docker compose --env-file .env --profile browser-audit -f compose.yml ps
docker compose --env-file .env -f compose.yml logs --since=20m \
  console api scheduler executor probe
```

## Console does not load

- Confirm the console is healthy and `127.0.0.1:5173` is not occupied.
- Verify `CONSOLE_PUBLIC_PORT` and `CONSOLE_ORIGIN`.
- If using a reverse proxy, test `curl http://127.0.0.1:5173/` on the host
  before debugging TLS or identity middleware.
- A console page can load while its server-side API proxy is unhealthy; inspect
  both console and API logs.

## API health or authentication

Start the loopback debug proxy only for diagnosis:

```sh
docker compose --env-file .env --profile debug -f compose.yml up -d api-debug
curl --fail http://127.0.0.1:8788/health
curl --fail -H "Authorization: Bearer $SELFHOST_ADMIN_TOKEN" \
  http://127.0.0.1:8788/v1/health
docker compose --env-file .env --profile debug -f compose.yml stop api-debug
```

A `401` usually means the caller and service do not share the same current or
next secret. A startup validation error means a required secret is missing,
too short, or still a placeholder. Never solve it by adding a fallback value.

## Region is unavailable or a Run stalls

- Confirm the code appears in all three region JSON settings.
- Confirm the executor can reach the configured origin and that the probe uses
  the same `PROBE_SHARED_SECRET`.
- Remote HTTP origins are rejected unless explicitly trusted; prefer HTTPS.
- Inspect executor logs for `missing_probe_region`, retry, or lease events and
  probe logs for signed-request rejection.
- A queued or running job survives API restart. Wait for the lease to expire
  before expecting another executor identity to reclaim it.

## Scheduler does not create Runs

- The interval must be at least five minutes and `nextRunAt` must be due.
- Confirm scheduler logs show authenticated dispatch success.
- Confirm `SELFHOST_SCHEDULER_API_BASE_URL` is the internal API origin and the
  internal secret matches.
- After an outage, the next successful dispatch advances from the recovery
  time; it does not create a backlog burst for every missed interval.

## Browser Audit stays queued or fails

- Confirm `SELFHOST_BROWSER_AUDIT_BASE_URL` is set and the
  `browser-audit` profile is healthy.
- Verify executor and runner share `BROWSER_AUDIT_SHARED_SECRET`.
- Keep 1 GiB of shared memory and unprivileged user namespaces available.
- A private target, redirect, subresource, download, popup, or unapproved port
  is blocked by design.
- Review the persisted normalized failure and checkpoints in **Reports** before
  changing sandbox or allowlist policy.

## Artifact download or disk issues

- An indexed artifact with missing bytes returns unavailable; restore the
  matching artifact snapshot.
- Check the configured per-file limit and upload-grant lifetime.
- Run maintenance to reconcile expired indexes and orphaned files.
- `VACUUM` needs free disk and an exclusive lock; it is never automatic.
- Do not use `docker compose down -v` to reclaim space.

## Database refuses to start

Run `doctor` in a one-off API container as shown in the
[upgrade guide](./upgrade.md). Unknown migrations mean the database was opened
by a newer release; use that release or restore its pre-upgrade backup. A
decryption failure means the matching current or next internal secret is not
available.

If an API response or log includes an `incidentId`, include that bounded ID and
the release version in a bug report, not raw secret-bearing payloads.
