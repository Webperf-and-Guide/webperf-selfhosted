import { isContractProcedure } from '@orpc/contract';

type OpenApiTag = {
  name: string;
  description?: string;
};

type OpenApiDoc = {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{ url: string }>;
  tags: OpenApiTag[];
  paths: Record<
    string,
    Record<
      string,
      {
        operationId?: string;
        summary?: string;
        description?: string;
        tags?: string[];
        responses: Record<string, { description: string }>;
      }
    >
  >;
};

type OpenApiSkeletonOptions = {
  title: string;
  version: string;
  description: string;
  serverUrl?: string;
  contract: unknown;
  tags: OpenApiTag[];
};

const traverseContract = (router: unknown, visit: (procedure: Record<string, unknown>) => void) => {
  if (isContractProcedure(router as never)) {
    visit(router as Record<string, unknown>);
    return;
  }

  if (!router || typeof router !== 'object') {
    return;
  }

  for (const value of Object.values(router)) {
    traverseContract(value, visit);
  }
};

export const buildOpenApiSkeletonDocument = (options: OpenApiSkeletonOptions): OpenApiDoc => {
  const doc: OpenApiDoc = {
    openapi: '3.1.0',
    info: {
      title: options.title,
      version: options.version,
      description: options.description
    },
    servers: [{ url: options.serverUrl ?? '/' }],
    tags: [...options.tags],
    paths: {}
  };

  traverseContract(options.contract, (procedure) => {
    const route = (procedure['~orpc'] as { route?: Record<string, unknown> } | undefined)?.route;

    if (!route || typeof route.path !== 'string') {
      return;
    }

    const method = typeof route.method === 'string' ? route.method.toLowerCase() : 'post';
    const path = route.path;

    doc.paths[path] ??= {};
    doc.paths[path]![method] = {
      operationId: typeof route.operationId === 'string' ? route.operationId : undefined,
      summary: typeof route.summary === 'string' ? route.summary : undefined,
      description: typeof route.description === 'string' ? route.description : undefined,
      tags: Array.isArray(route.tags) ? route.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
      responses: {
        '200': {
          description: typeof route.successDescription === 'string' ? route.successDescription : 'OK'
        }
      }
    };
  });

  return doc;
};

export type { OpenApiDoc, OpenApiTag };
