# Public API Surface

This is the current v1 public resource surface for `webperf-selfhosted`.

The intent is to stabilize this shape before adding new top-level resources.

## Primary Resource-Oriented Surface

- `GET /v1/sites`
- `POST /v1/sites`
- `GET /v1/sites/:siteId`
- `GET /v1/route-groups`
- `POST /v1/route-groups`
- `GET /v1/route-groups/:routeGroupId`
- `GET /v1/region-sets`
- `POST /v1/region-sets`
- `GET /v1/region-sets/:regionSetId`
- `GET /v1/checks`
- `POST /v1/checks`
- `GET /v1/checks/:checkId`
- `GET /v1/runs`
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
- `GET /v1/capabilities`

## Compatibility Aliases

The older self-host aliases remain supported:

- `/v1/properties`
- `/v1/route-sets`
- `/v1/region-packs`
- `/v1/check-profiles`

New work should prefer the resource-oriented surface first and keep compatibility aliases as migration-friendly adapters.

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
- `runs`
- `comparisons`
- `exports`
- `analyses`
- `browserAudits`

## OpenAPI

The API serves:

- `GET /openapi/public.json`
- `GET /openapi/control.json`

Those documents are generated from the checked-in contracts and should reflect the frozen v1 surface above.
