# Install WebPerf self-hosted

The supported operator path is a tagged GitHub Release bundle. It contains a
Compose file with all six runtime images pinned by OCI digest, an environment
template, runtime metadata, SPDX SBOMs, checksums, security notes, and the
license.

## Requirements

- Docker Engine with the Compose v2 plugin;
- a Linux/amd64 host, or a container runtime configured to emulate amd64;
- enough persistent disk for SQLite history and optional Browser Audit files;
- loopback port `5173`, or another port set with `CONSOLE_PUBLIC_PORT`;
- `openssl` or another cryptographically secure secret generator.

The default services fit a small installation. The optional browser profile
needs materially more memory and at least 1 GiB of shared memory; the checked-in
Compose profile configures the latter.

## 1. Download and verify

Download the release archive and its top-level `SHA256SUMS` from
[GitHub Releases](https://github.com/Webperf-and-Guide/webperf-selfhosted/releases).

```sh
sha256sum --check SHA256SUMS
tar -xzf webperf-selfhosted-v*.tar.gz
cd webperf-selfhosted-v*/
sha256sum --check SHA256SUMS
```

On macOS, use `shasum -a 256 -c SHA256SUMS`. Do not reconstruct the official
Compose file from mutable image tags: the release copy is already bound to the
digests recorded in `runtime-metadata.json`.

## 2. Create the environment file

```sh
cp .env.example .env
chmod 600 .env
openssl rand -base64 32
```

Run the secret command four times and assign independent values to:

- `SELFHOST_ADMIN_TOKEN`;
- `SELFHOST_INTERNAL_SECRET`;
- `PROBE_SHARED_SECRET`;
- `BROWSER_AUDIT_SHARED_SECRET`.

Do not reuse a password or leave a `replace-with-...` value. Leave every
`*_NEXT` value empty until a planned rotation. If the public origin will not be
`http://localhost:5173`, set `CONSOLE_ORIGIN` before the first start.

## 3. Validate and start

```sh
docker compose --env-file .env -f compose.yml config --quiet
docker compose --env-file .env -f compose.yml up -d
docker compose --env-file .env -f compose.yml ps
```

Wait until `console`, `api`, `scheduler`, `executor`, and `probe` are healthy,
then verify the loopback console:

```sh
curl --fail --show-error http://127.0.0.1:5173/
```

Open `http://127.0.0.1:5173`, launch a one-off check against a public URL, and
confirm that its Tokyo target reaches a terminal state.

## Default exposure

Only the console publishes a host port, and it binds to `127.0.0.1`. All other
services communicate on segmented Compose networks. The persistent
`webperf-data` volume stores `/data/webperf.sqlite` and `/data/artifacts`.

The `debug` profile creates temporary loopback-only proxies for diagnosis. It
is not part of normal operation and must never be exposed through a public
reverse proxy.

## Next steps

- Review every setting in [Configure](./configure.md).
- Read [Security](./security.md) before remote access.
- Add real probe locations with [Regions](./regions.md).
- Establish a recovery point with [Backup and restore](./backup-restore.md).
- Enable the optional [Browser Audit](./browser-audits.md) only when needed.
