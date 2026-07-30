# Public API Surface

This is the current v1 public resource surface for `webperf-selfhosted`.

Treat this document as the current freeze line:

- do not add new top-level resources without an explicit v1 boundary decision
- do keep list/query behavior aligned across the existing list surfaces
- do keep the compatibility aliases working, but treat them as compatibility-first surfaces instead of the preferred model

## Primary Resource-Oriented Surface

- `GET /v1/sites`
- `POST /v1/sites`
- `GET /v1/sites/:siteId`
- `GET /v1/route-groups`
- `POST /v1/route-groups`
- `GET /v1/route-groups/:routeGroupId`
- `GET /v1/checks`
- `POST /v1/checks`
- `GET /v1/checks/:checkId`
- `GET /v1/checks/:checkId/runs`
- `POST /v1/checks/:checkId/runs`
- `GET /v1/runs/:runId`
- `GET /v1/comparisons`
- `POST /v1/comparisons`
- `GET /v1/comparisons/:comparisonId`
- `GET /v1/exports`
- `POST /v1/exports`
- `GET /v1/exports/:exportId`
- `GET /v1/analyses`
- `POST /v1/analyses`
- `GET /v1/analyses/:analysisId`
- `GET /v1/browser-audits`
- `POST /v1/browser-audits`
- `GET /v1/browser-audits/:id`
- `GET /v1/browser-audits/:id/artifacts/:artifactId`
- `GET /v1/regions`
- `GET /v1/capabilities`
- `GET /v1/runtime-metrics` — protected provider-neutral queue/lease snapshot

Authentication boundary:

- `GET /health` is the unauthenticated, minimal process health probe.
- `GET /v1/capabilities` and `GET /openapi/public.json` are unauthenticated.
- `GET /v1/health`, artifact downloads, and every data or execution endpoint
  require the appropriate administrator or internal-service bearer token.
- `GET /v1/runtime-metrics` requires the administrator token.

Request boundary:

- JSON request bodies on the resource-oriented `/v1` routes are limited to
  1 MiB and return `413` before parsing when the declared or streamed body is larger.
- Browser Audit binary uploads use their separately configured per-artifact
  limit and do not pass through the JSON reader.

## Compatibility Aliases

The older self-host aliases remain supported:

- `/v1/properties`
- `/v1/route-sets`
- `/v1/check-profiles`

`/v1/region-packs` and `/v1/region-sets` were removed in Phase 1 of issue #14
and now return `410 Gone`. One standalone deployment measures from one fixed
runtime location reported by `GET /v1/regions`, so there is no region-set
resource to migrate to.

New work should prefer the resource-oriented surface first and keep compatibility aliases as migration-friendly adapters.
Those compatibility list endpoints keep the same shared list query contract as the primary resource-oriented list routes.

Published beta stored-data compatibility is separate from the retired Region
Set HTTP surface. Historical Jobs retain their original target regions.
Migrated saved Checks expose `locationMigration`: unsafe multi-region,
mismatched, or missing Region Set definitions are unscheduled and cannot run
until an update explicitly sets `acknowledgeLocationMigration: true`.

Every response below a compatibility prefix includes:

- `Deprecation: true`
- a `Link` header with `rel="successor-version"` pointing to the canonical path
- an HTTP `Warning` identifying the successor path

The aliases receive compatibility fixes only. New capabilities land on canonical
resources first. They are migration candidates for removal at public v1.0 after
managed consumers and existing self-host installations have moved to the
canonical paths.

`runs` are intentionally not a top-level list resource in v1:

- list runs under `GET /v1/checks/:checkId/runs`
- fetch a persisted run detail under `GET /v1/runs/:runId`

## List Contract

List resources use a shared query model:

- `pageSize`
- `pageToken`
- `filter`

List responses return:

- resource array
- `pageInfo.pageSize`
- `pageInfo.totalCount`
- `pageInfo.nextPageToken`
- `pageInfo.filter`

Current stabilization focus is on keeping this list contract consistent across:

- `checks`
- `checks/:checkId/runs`
- compatibility aliases for `properties`, `route-sets`, and `check-profiles`
- `comparisons`
- `exports`
- `analyses`
- `browserAudits`

## OpenAPI

The API serves:

- `GET /openapi/public.json`
- `GET /openapi/control.json`

Those documents are generated from the checked-in contracts and should reflect the frozen v1 surface above.
