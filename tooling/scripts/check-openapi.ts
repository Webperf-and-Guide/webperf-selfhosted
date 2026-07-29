import { buildControlOpenApiDocument } from '../../packages/contracts/src/control-openapi';
import { buildPublicOpenApiDocument } from '../../packages/contracts/src/public-openapi';
import { buildRegionalRuntimeOpenApiDocument } from '../../packages/contracts/src/regional-runtime-openapi';

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

const regionalRuntimeDoc = buildRegionalRuntimeOpenApiDocument({
  title: 'WebPerf Regional Runtime API',
  version: 'v1',
  description: 'Managed Cloud handoff to one fixed regional runtime.'
});

const requiredPublicPaths = [
  '/v1/capabilities',
  '/v1/sites',
  '/v1/sites/{siteId}',
  '/v1/route-groups',
  '/v1/route-groups/{routeGroupId}',
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
  '/v1/browser-audits/{auditId}',
  '/v1/browser-audits/{auditId}/artifacts/{artifactId}'
] as const;

const requiredControlPaths = [
  '/v1/properties',
  '/v1/properties/{id}',
  '/v1/route-sets',
  '/v1/route-sets/{id}',
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
assertPaths('regional-runtime', regionalRuntimeDoc.paths, [
  '/v1/regional-capabilities',
  '/v1/regional-executions',
  '/v1/regional-executions/{idempotencyKey}'
]);

if (!publicDoc.components?.securitySchemes.selfhostAdminToken) {
  throw new Error('public OpenAPI document is missing the self-host admin bearer scheme');
}

assertPathSecurity(
  'public',
  publicDoc.paths,
  (path) => path === '/v1/capabilities'
);
assertPathSecurity('compatibility', controlDoc.paths, () => false);

if (!regionalRuntimeDoc.components?.securitySchemes.regionalRuntimeToken) {
  throw new Error('regional runtime OpenAPI document is missing its bearer scheme');
}

assertPathSecurity(
  'regional runtime',
  regionalRuntimeDoc.paths,
  (path) => path === '/v1/regional-capabilities'
);

console.log(
  JSON.stringify(
    {
      ok: true,
      publicPathCount: Object.keys(publicDoc.paths).length,
      controlPathCount: Object.keys(controlDoc.paths).length,
      regionalRuntimePathCount: Object.keys(regionalRuntimeDoc.paths).length
    },
    null,
    2
  )
);

function assertPaths(
  label: 'public' | 'control' | 'regional-runtime',
  paths: Record<string, unknown>,
  requiredPaths: readonly string[]
) {
  const missing = requiredPaths.filter((path) => !(path in paths));

  if (missing.length > 0) {
    throw new Error(`${label} OpenAPI document is missing required paths: ${missing.join(', ')}`);
  }
}

function assertPathSecurity(
  label: string,
  paths: Record<string, Record<string, { security?: unknown }>>,
  isPublicPath: (path: string) => boolean
) {
  for (const [path, methods] of Object.entries(paths)) {
    for (const operation of Object.values(methods)) {
      const shouldBePublic = isPublicPath(path);
      if (shouldBePublic && operation.security) {
        throw new Error(`public ${label} path ${path} must remain unauthenticated in OpenAPI`);
      }
      if (!shouldBePublic && !operation.security) {
        throw new Error(`protected ${label} path ${path} must declare bearer authentication`);
      }
    }
  }
}
