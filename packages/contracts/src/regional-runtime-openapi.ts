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
) => buildOpenApiSkeletonDocument({
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
