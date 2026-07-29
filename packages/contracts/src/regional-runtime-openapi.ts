import {
  REGIONAL_RUNTIME_OPENAPI_TAG_DEFINITIONS,
  regionalRuntimeContract
} from './regional-runtime-contract';
import { buildOpenApiSkeletonDocument } from './openapi-skeleton';

type RegionalRuntimeOpenApiOptions = {
  title: string;
  version: string;
  description: string;
  serverUrl?: string;
};

export const buildRegionalRuntimeOpenApiDocument = (
  options: RegionalRuntimeOpenApiOptions
) => {
  const document = buildOpenApiSkeletonDocument({
    ...options,
    contract: regionalRuntimeContract,
    tags: [...REGIONAL_RUNTIME_OPENAPI_TAG_DEFINITIONS],
    bearerAuth: {
      schemeName: 'regionalRuntimeToken',
      publicPaths: ['/v1/regional-capabilities'],
      description:
        'REGIONAL_RUNTIME_SHARED_SECRET bearer token for managed Cloud handoff operations.'
    }
  });
  const createResponses = document.paths['/v1/regional-executions']?.post?.responses;
  if (!createResponses) {
    throw new Error('Regional Runtime OpenAPI document is missing the execution create operation');
  }
  createResponses['202'] = {
    description: 'Accepted a new regional execution'
  };
  createResponses['200'] = {
    description: 'Returned the existing execution for an idempotent replay'
  };
  return document;
};
