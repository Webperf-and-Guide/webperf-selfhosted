# Configure the runtime location

One standalone `webperf-selfhosted` deployment represents **one fixed
measurement region**. The runtime location is an operator-chosen identity,
not a city claim: every Fast Check, scheduled Check, and Browser Audit runs
from this single location and records it on its results as provenance.

The WebPerf & Guide managed service coordinates several regional probes
under one control plane; that multi-region orchestration lives outside this
repository. A self-host installation only knows its own runtime location.

## Configuration

```dotenv
SELFHOST_REGION_ID=local
SELFHOST_REGION_LABEL=Home lab
SELFHOST_PROBE_BASE_URL=http://probe:8080
```

- `SELFHOST_REGION_ID` is the stable serialized identifier. It must be 1–64
  lowercase ASCII letters, digits, or hyphens, starting and ending with a
  letter or digit. The default `local` makes no city claim.
- `SELFHOST_REGION_LABEL` is the optional display name shown on the Console
  Runtime Location card. It defaults to the region id when omitted. Persisted
  targets, Browser Audits, and comparison reports carry the serialized region
  id, not the label.
- `SELFHOST_PROBE_BASE_URL` is the credential-free HTTP(S) origin of the
  Rust probe. The executor appends the signed `/measure` path itself.

Operators choose identities that match their actual deployment, for example:

```dotenv
SELFHOST_REGION_ID=kr-seoul-office
SELFHOST_REGION_LABEL=Seoul office runtime
SELFHOST_PROBE_BASE_URL=http://probe:8080
```

The previous multi-region configuration unit
(`SELFHOST_ACTIVE_REGION_CODES_JSON`, `SELFHOST_REGION_IDS_JSON`,
`SELFHOST_PROBE_BASE_URLS_JSON`) and the 41-city catalog were removed in
Phase 1 of issue #14. Upgrades from the published multi-region beta preserve
historical job target regions. Saved Checks that used one matching region keep
their schedules; multi-region, missing, or mismatched region-pack references
are unscheduled and marked for explicit operator review before they can run at
the current runtime location. See [Upgrade](upgrade.md) for the review flow.

## Add a remote probe

The bundled Compose deployment runs the probe as a sibling container. To
measure from a remote location instead:

1. Deploy the versioned `webperf-probe` image on a host that represents the
   runtime location.
2. Give it the same `PROBE_SHARED_SECRET` used by the executor and set its
   `REGION_ID` to the same value as `SELFHOST_REGION_ID` on `webperf`.
3. Terminate TLS at the probe or a private ingress and restrict network
   access to the executor.
4. Set `SELFHOST_PROBE_BASE_URL` to the probe's HTTPS origin on `webperf`.
5. Set `SELFHOST_EXECUTOR_ALLOW_INSECURE_PROBE_HTTP=false` for remote probes.
6. Recreate `webperf` so its API and executor processes pick up the new
   environment:

   ```sh
   docker compose --env-file .env -f compose.yml up -d --force-recreate webperf
   ```

The executor appends the signed `/measure` path itself; configure only an
origin, without credentials, path, query, or fragment.

The insecure-HTTP opt-in permits RFC 1918/ULA resolution only for explicit
container/LAN-shaped origins such as the single-label `probe` service or a
private IP literal. Metadata, link-local, loopback rebinding,
documentation, benchmarking, multicast, and reserved ranges remain blocked;
public FQDNs must still resolve exclusively to public addresses.

## Measurement semantics

Fast Check currently reports DNS lookup time, response-header elapsed time
as a TTFB approximation, final URL, redirect count, HTTP status,
success/failure, and total elapsed time to response headers. It does not
claim full-page download time. TCP/TLS phase timing, TLS version, ALPN, and
cipher remain null with capability flags false until the probe measures
them directly.

The probe validates each redirect, rejects private/local/reserved targets,
and pins validated DNS addresses into the connection layer. Do not weaken
this policy to reach internal applications; use a deliberately isolated
deployment and assess the SSRF impact first.

## Console view

The **Runtime Location** page (`/regions`) shows this deployment's region id
and label. It no longer presents a city catalog or a Region Set builder,
because one standalone installation measures from exactly one location.
