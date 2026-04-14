import { CONTROL_OPENAPI_TAG_DEFINITIONS, controlContract } from './control-contract';
import { buildOpenApiSkeletonDocument } from './openapi-skeleton';

type ControlOpenApiOptions = {
  title: string;
  version: string;
  description: string;
  serverUrl?: string;
};

export const buildControlOpenApiDocument = (options: ControlOpenApiOptions) =>
  buildOpenApiSkeletonDocument({
    ...options,
    contract: controlContract,
    tags: [...CONTROL_OPENAPI_TAG_DEFINITIONS]
  });
