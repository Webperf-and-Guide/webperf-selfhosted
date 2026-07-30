import { oc, populateContractRouterPaths, type as orpcType } from '@orpc/contract';
import { z } from 'zod';
import {
  regionalExecutionIdempotencyKeySchema,
  regionalExecutionRequestSchema,
  regionalExecutionResultSchema,
  regionalRuntimeCapabilitiesSchema
} from './regional-runtime';
import { runtimeMetricsSchema } from './runtime-metrics';

const regionalExecutionParamsSchema = z.object({
  idempotencyKey: regionalExecutionIdempotencyKeySchema
});
const regionalExecutionParamsInputSchema = z.object({
  params: regionalExecutionParamsSchema
});

export const REGIONAL_RUNTIME_OPENAPI_TAG_DEFINITIONS = [{
  name: 'regionalRuntime',
  description: 'Provider-neutral managed Cloud handoff to one fixed regional runtime.'
}] as const;

export const regionalRuntimeContract = populateContractRouterPaths(oc.router({
  capabilities: {
    get: oc
      .input(orpcType<void>())
      .output(regionalRuntimeCapabilitiesSchema)
      .route({
        method: 'GET',
        path: '/v1/regional-capabilities',
        summary: 'Get regional runtime capabilities',
        tags: ['regionalRuntime']
      })
  },
  metrics: {
    get: oc
      .input(orpcType<void>())
      .output(runtimeMetricsSchema)
      .route({
        method: 'GET',
        path: '/v1/runtime-metrics',
        summary: 'Get provider-neutral runtime metrics',
        tags: ['regionalRuntime']
      })
  },
  executions: {
    create: oc
      .input(regionalExecutionRequestSchema)
      .output(regionalExecutionResultSchema)
      .route({
        method: 'POST',
        path: '/v1/regional-executions',
        summary: 'Submit an idempotent regional execution batch',
        tags: ['regionalRuntime']
      }),
    get: oc
      .input(regionalExecutionParamsInputSchema)
      .output(regionalExecutionResultSchema)
      .route({
        method: 'GET',
        path: '/v1/regional-executions/{idempotencyKey}',
        inputStructure: 'detailed',
        summary: 'Get a regional execution result',
        tags: ['regionalRuntime']
      }),
    cancel: oc
      .input(regionalExecutionParamsInputSchema)
      .output(regionalExecutionResultSchema)
      .route({
        method: 'DELETE',
        path: '/v1/regional-executions/{idempotencyKey}',
        inputStructure: 'detailed',
        summary: 'Cancel a regional execution',
        tags: ['regionalRuntime']
      })
  }
}));
