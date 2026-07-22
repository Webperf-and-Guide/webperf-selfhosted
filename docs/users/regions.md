# Configure regions and probes

The Regions page distinguishes the public city catalog from runtimes that this
installation can actually use. The catalog models 41 city codes; a city is
selectable only when the operator activates it, supplies a region hint, and
maps it to a reachable Rust probe.

The default Compose installation activates Tokyo and maps it to the bundled
`probe` container. A catalog entry alone is not evidence that a probe exists in
that city.

## Region configuration

These variables form one configuration unit:

```dotenv
SELFHOST_ACTIVE_REGION_CODES_JSON=["tokyo","frankfurt"]
SELFHOST_REGION_IDS_JSON={"tokyo":"JP","frankfurt":"DE"}
SELFHOST_PROBE_BASE_URLS_JSON={"tokyo":"http://probe:8080","frankfurt":"https://probe.internal.example"}
```

- `SELFHOST_ACTIVE_REGION_CODES_JSON` is the selectable subset of the catalog.
- `SELFHOST_REGION_IDS_JSON` supplies the location/provider hint shown with an
  active runtime.
- `SELFHOST_PROBE_BASE_URLS_JSON` tells the executor where to call each probe.

Every Check selects a Region Set of one to four active codes. Duplicate and
inactive codes are rejected.

## Add a remote probe

1. Deploy the versioned `webperf-probe` image in the representative city.
2. Give it the same `PROBE_SHARED_SECRET` used by the executor and set its
   `REGION_CODE` and listen address.
3. Terminate TLS at the probe or a private ingress and restrict network access
   to the executor.
4. Add the code, hint, and HTTPS origin to the three JSON settings above.
5. Set `SELFHOST_EXECUTOR_ALLOW_INSECURE_PROBE_HTTP=false` for remote probes.
6. Recreate the API and executor, then confirm the city is selectable on the
   Regions page.

The executor appends the signed `/measure` path itself; configure only an
origin, without credentials, path, query, or fragment.

## Measurement semantics

Fast Check currently reports DNS lookup time, response-header elapsed time as
a TTFB approximation, final URL, redirect count, HTTP status, success/failure,
and total elapsed time to response headers. It does not claim full-page
download time. TCP/TLS phase timing, TLS version, ALPN, and cipher remain null
with capability flags false until the probe measures them directly.

The probe validates each redirect, rejects private/local/reserved targets, and
pins validated DNS addresses into the connection layer. Do not weaken this
policy to reach internal applications; use a deliberately isolated deployment
and assess the SSRF impact first.

## Build Region Sets

In the console, open **Resources**, create a named Region Set from active
locations, and reuse it across Checks. Prefer the smallest set that represents
real users or release risk. More cities are not automatically a better release
gate if their probes do not represent the deployment corridor.
