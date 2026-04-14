import { oc, populateContractRouterPaths, type as orpcType } from '@orpc/contract';
import { z } from 'zod';
import {
  createLatencyJobSchema,
  jobSnapshotEventSchema,
  jobListResponseSchema,
  listQuerySchema,
  latencyJobDetailSchema,
  regionsResponseSchema,
  schedulerDispatchResponseSchema
} from './public-api';
import { controlHealthSchema } from './control-contract';

const jobIdSchema = z.object({
  jobId: z.string().min(1)
});

const schedulerDispatchInputSchema = z.object({
  now: z.string().datetime().nullable().optional()
});

const listInputSchema = z.object({
  query: listQuerySchema.optional()
});

export const opsContract = populateContractRouterPaths(
  oc.router({
    system: {
      health: oc
        .input(orpcType<void>())
        .output(controlHealthSchema)
        .route({
          method: 'GET',
          path: '/v1/health',
          summary: 'Ops health'
        }),
      regions: oc
        .input(orpcType<void>())
        .output(regionsResponseSchema)
        .route({
          method: 'GET',
          path: '/v1/regions',
          summary: 'Ops region catalog'
        })
    },
    jobs: {
      list: oc
        .input(listInputSchema)
        .output(jobListResponseSchema)
        .route({
          method: 'GET',
          path: '/v1/jobs',
          inputStructure: 'detailed',
          summary: 'List jobs'
        }),
      create: oc
        .input(createLatencyJobSchema)
        .output(z.object({ job: latencyJobDetailSchema }))
        .route({
          method: 'POST',
          path: '/v1/jobs',
          summary: 'Create job'
        }),
      get: oc
        .input(z.object({ params: jobIdSchema }))
        .output(latencyJobDetailSchema)
        .route({
          method: 'GET',
          path: '/v1/jobs/{jobId}',
          inputStructure: 'detailed',
          summary: 'Get job'
        }),
      stream: oc
        .input(z.object({ params: jobIdSchema }))
        .output(jobSnapshotEventSchema)
        .route({
          method: 'GET',
          path: '/v1/jobs/{jobId}/stream',
          inputStructure: 'detailed',
          summary: 'Get latest job snapshot'
        })
    },
    scheduler: {
      dispatch: oc
        .input(schedulerDispatchInputSchema)
        .output(schedulerDispatchResponseSchema)
        .route({
          method: 'POST',
          path: '/v1/scheduler/dispatch',
          summary: 'Dispatch scheduled checks'
        })
    }
  })
);

export type OpsContract = typeof opsContract;
