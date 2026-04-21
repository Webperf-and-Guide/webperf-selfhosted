import { buildControlOpenApiDocument } from '../../packages/contracts/src/control-openapi';
import { buildPublicOpenApiDocument } from '../../packages/contracts/src/public-openapi';

const publicDoc = buildPublicOpenApiDocument({
  title: 'WebPerf Public API',
  version: 'v1',
  description: 'Frozen v1 public API surface.'
});

const controlDoc = buildControlOpenApiDocument({
  title: 'WebPerf Control API',
  version: 'v1',
  description: 'Compatibility control API surface.'
});

const requiredPublicPaths = [
  '/v1/capabilities',
  '/v1/sites',
  '/v1/sites/{siteId}',
  '/v1/route-groups',
  '/v1/route-groups/{routeGroupId}',
  '/v1/region-sets',
  '/v1/region-sets/{regionSetId}',
  '/v1/checks',
  '/v1/checks/{checkId}',
  '/v1/checks/{checkId}/runs',
  '/v1/runs/{runId}',
  '/v1/comparisons',
  '/v1/comparisons/{comparisonId}',
  '/v1/exports',
  '/v1/exports/{exportId}',
  '/v1/analyses',
  '/v1/analyses/{analysisId}',
  '/v1/browser-audits',
  '/v1/browser-audits/{auditId}'
] as const;

const requiredControlPaths = [
  '/v1/properties',
  '/v1/properties/{id}',
  '/v1/route-sets',
  '/v1/route-sets/{id}',
  '/v1/region-packs',
  '/v1/region-packs/{id}',
  '/v1/check-profiles',
  '/v1/check-profiles/{id}',
  '/v1/check-profiles/{id}/runs',
  '/v1/check-profiles/{id}/runs/{runId}',
  '/v1/check-profiles/{id}/compare/latest',
  '/v1/check-profiles/{id}/compare/baseline',
  '/v1/check-profiles/{id}/report'
] as const;

assertPaths('public', publicDoc.paths, requiredPublicPaths);
assertPaths('control', controlDoc.paths, requiredControlPaths);

console.log(
  JSON.stringify(
    {
      ok: true,
      publicPathCount: Object.keys(publicDoc.paths).length,
      controlPathCount: Object.keys(controlDoc.paths).length
    },
    null,
    2
  )
);

function assertPaths(
  label: 'public' | 'control',
  paths: Record<string, unknown>,
  requiredPaths: readonly string[]
) {
  const missing = requiredPaths.filter((path) => !(path in paths));

  if (missing.length > 0) {
    throw new Error(`${label} OpenAPI document is missing required paths: ${missing.join(', ')}`);
  }
}
