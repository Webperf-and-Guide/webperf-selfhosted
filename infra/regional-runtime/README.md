# Regional runtime deployment profile

This directory contains the provider-neutral deployment shape for one managed
regional runtime. It is intentionally smaller than the standalone self-host
product:

```text
regional-api      webperf image, role regional-runtime
regional-executor webperf image, role executor
probe             webperf-probe image
```

There is no Console, scheduler, Browser Audit runner, Region Set, billing, or
fleet controller in this profile.

`compose.yml` is the local/reference deployment. `multi-container-profile.json`
is the machine-readable co-located-pod mapping used by managed providers whose
containers share one network namespace. In that mapping the API, executor, and
probe communicate through `127.0.0.1` on distinct ports.

## Runtime invariants

- One deployment has one fixed `SELFHOST_REGION_ID`.
- Version 1 executes network probes only.
- The public ingress exposes only regional API port `8788`.
- Executor and probe ports remain private.
- API and executor use the same immutable `webperf` release digest.
- Probe uses the matching immutable `webperf-probe` release digest.
- A writable persistent volume is mounted at `/data` for SQLite durability.
- The API and executor use an independent internal secret.
- Cloud handoff and probe calls use separate current/next secrets.
- The regional role does not require a self-host administrator token.
- The executor does not require a Browser Audit secret unless a Browser Audit
  origin is configured.

The v1 SQLite queue and status polling contract require exactly one active pod
for a regional deployment. Multiple pods would have independent databases and
could return inconsistent status for the same idempotency key. Scale-out
requires a future shared-state protocol revision; do not raise the maximum
replica count for this profile.

## Local validation

```sh
bun run compose:regional:config
bun run smoke:regional-runtime
```

The smoke creates an isolated temporary Compose project, generates the three
required secrets, submits a signed execution, waits for the executor and Rust
probe, verifies the signed result, and removes the project.

For a persistent manual launch, copy `.env.example` to an operator-owned env
file, replace its three secret placeholders, and run `compose.yml` with
`compose.dev.yml`. The reference Compose file publishes the API on loopback
only. A managed provider may attach its TLS HTTP ingress to container port
`8788`, but it must not expose the executor or probe.

Provider credentials, application IDs, region selection, deploy/undeploy
control, capacity policy, and global fan-out belong to the managed Cloud
repository. Managed consumers select image digests from a specific release's
`runtime-metadata.json` and map this profile into their provider adapter.
