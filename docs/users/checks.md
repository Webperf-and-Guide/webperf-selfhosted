# Create and evaluate Checks

The operator workflow separates reusable inputs from execution history:

- a **Site** owns the base public origin;
- a **Route Group** contains representative paths;
- a **Region Set** selects one to four active probes;
- a **Check** combines those resources with request, monitor, alert, schedule,
  and optional Browser Audit policy;
- a **Run** is one immutable execution attempt and its target results.

## Start with a manual run

Use **Run** for a one-off public URL before creating reusable resources. This
confirms that the target passes SSRF policy, the selected probes are healthy,
and the latency or uptime rule is sensible.

Fast Check evaluates status after redirects and measures through response
headers. A 2xx or 3xx response is the supported success rule. Latency policy
can add a positive millisecond threshold; uptime policy focuses on outcome.

## Save reusable resources

1. In **Resources**, create the Site.
2. Add a Route Group with the small set of routes that represent a deploy.
3. Add a Region Set containing active probes.
4. In **Checks**, select those three resources and name the gate.
5. Optionally add an interval of at least five minutes, request overrides, a
   latency threshold, and webhook targets.

Custom requests support `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, and
`OPTIONS`, up to 20 headers, and a bounded text body. `GET` and `HEAD` cannot
carry a body. Authorization, cookies, API keys, tokens, secrets, and URL query
values are encrypted at rest and masked from API, event, export, and console
surfaces.

## Baselines and comparisons

Run the saved Check at least twice. WebPerf automatically compares the newest
Run with the previous Run. To preserve a known-good release, pin one successful
Run as the baseline; future Runs then expose both latest-vs-previous and
latest-vs-baseline views.

Only pin a baseline after reviewing every representative route. Replacing a
baseline changes the reference point but does not rewrite old Runs or derived
reports.

## Alerts

A Check can send up to five generic webhook targets on failure, latency
threshold breach, or regression. Targets must use HTTPS and pass the same
public-network URL policy as measurements. A legacy public HTTP target requires
the executor's explicit `SELFHOST_EXECUTOR_ALLOW_INSECURE_WEBHOOK_HTTP=true`
opt-in, which does not permit private addresses. Each delivery includes an `Idempotency-Key`; when
a target secret is configured, `X-WebPerf-Signature` contains
`t=<unix-seconds>,v1=<HMAC-SHA256>` over `<unix-seconds>.<exact JSON body>`.
Newly configured signing secrets must contain between 16 and 200 characters.
The same timestamp is sent as `X-WebPerf-Timestamp`; receivers should require a
small freshness window before accepting the signature.

Webhook work is durable and retry-safe. A delivered target is not sent twice
for the same Run, and response bodies are never copied into operator errors.

## Reports and exports

Use **Reports** to browse persisted comparisons, deterministic analyses, JSON
or CSV exports, and optional Browser Audits separately from configuration.
Compatibility API names such as `properties` and `check-profiles` are
migration-only; new integrations should use canonical `sites`, `routeGroups`,
`regionSets`, and `checks` resources documented in the
[public API surface](../architecture/public-api-surface.md).
