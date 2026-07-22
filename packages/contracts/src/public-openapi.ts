import { PUBLIC_OPENAPI_TAG_DEFINITIONS, publicContract } from './public-contract';
import { buildOpenApiSkeletonDocument } from './openapi-skeleton';

type PublicOpenApiOptions = {
  title: string;
  version: string;
  description: string;
  serverUrl?: string;
};

export const buildPublicOpenApiDocument = (options: PublicOpenApiOptions) =>
  buildOpenApiSkeletonDocument({
    ...options,
    contract: publicContract,
    tags: [...PUBLIC_OPENAPI_TAG_DEFINITIONS],
    bearerAuth: {
      schemeName: 'selfhostAdminToken',
      publicPaths: ['/v1/capabilities'],
      description: 'SELFHOST_ADMIN_TOKEN for protected self-host API operations.'
    }
  });
