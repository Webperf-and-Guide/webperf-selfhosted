import { PUBLIC_OPENAPI_TAG_DEFINITIONS, publicContract } from './public-contract';
import { buildOpenApiSkeletonDocument } from './openapi-skeleton';
import { browserAuditArtifactDownloadRoute } from './browser-audit';

type PublicOpenApiOptions = {
  title: string;
  version: string;
  description: string;
  serverUrl?: string;
};

const selfhostAdminSchemeName = 'selfhostAdminToken';

export const buildPublicOpenApiDocument = (options: PublicOpenApiOptions) => {
  const document = buildOpenApiSkeletonDocument({
    ...options,
    contract: publicContract,
    tags: [...PUBLIC_OPENAPI_TAG_DEFINITIONS],
    bearerAuth: {
      schemeName: selfhostAdminSchemeName,
      publicPaths: ['/v1/capabilities'],
      description: 'SELFHOST_ADMIN_TOKEN for protected self-host API operations.'
    }
  });

  document.paths[browserAuditArtifactDownloadRoute.path] = {
    [browserAuditArtifactDownloadRoute.method]: {
      operationId: browserAuditArtifactDownloadRoute.operationId,
      summary: browserAuditArtifactDownloadRoute.summary,
      description: browserAuditArtifactDownloadRoute.description,
      tags: [...browserAuditArtifactDownloadRoute.tags],
      security: [{ [selfhostAdminSchemeName]: [] }],
      responses: {
        '200': { description: 'Artifact byte stream' }
      }
    }
  };

  return document;
};
