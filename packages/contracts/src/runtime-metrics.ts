import { z } from 'zod';
import {
  executionJobKindValues,
  executionJobStatusValues,
  type ExecutionJobKind,
  type ExecutionJobStatus
} from './execution';
import { runtimeLocationSchema } from './regions';

export const runtimeMetricsSchemaVersion = 1 as const;
export const runtimeTopology = 'single-replica-sqlite' as const;
export const executorConcurrency = 1 as const;

const executionStatusCountSchema = z.number().int().nonnegative();
const runtimeExecutionStatusCountsShape = Object.fromEntries(
  executionJobStatusValues.map((status) => [status, executionStatusCountSchema])
) as Record<ExecutionJobStatus, typeof executionStatusCountSchema>;

export const runtimeExecutionStatusCountsSchema = z.object(
  runtimeExecutionStatusCountsShape
);
export type RuntimeExecutionStatusCounts = z.infer<
  typeof runtimeExecutionStatusCountsSchema
>;

const runtimeExecutionByKindShape = Object.fromEntries(
  executionJobKindValues.map((kind) => [
    kind,
    runtimeExecutionStatusCountsSchema
  ])
) as Record<ExecutionJobKind, typeof runtimeExecutionStatusCountsSchema>;

export const runtimeExecutionQueueMetricsSchema = z.object({
  ready: z.number().int().nonnegative(),
  delayed: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  expiredLeases: z.number().int().nonnegative(),
  retryQueued: z.number().int().nonnegative(),
  exhausted: z.number().int().nonnegative(),
  oldestReadyAgeMs: z.number().int().nonnegative().nullable(),
  oldestActiveAgeMs: z.number().int().nonnegative().nullable(),
  byStatus: runtimeExecutionStatusCountsSchema,
  byKind: z.object(runtimeExecutionByKindShape)
});
export type RuntimeExecutionQueueMetrics = z.infer<
  typeof runtimeExecutionQueueMetricsSchema
>;

export const runtimeMetricsSchema = z.object({
  schemaVersion: z.literal(runtimeMetricsSchemaVersion),
  observedAt: z.string().datetime(),
  runtimeLocation: runtimeLocationSchema,
  executions: runtimeExecutionQueueMetricsSchema,
  capacity: z.object({
    topology: z.literal(runtimeTopology),
    executorConcurrency: z.literal(executorConcurrency),
    horizontalScalingSafe: z.literal(false)
  }),
  retention: z.object({
    terminalCountsBoundedDays: z.number().int().positive()
  })
});
export type RuntimeMetrics = z.infer<typeof runtimeMetricsSchema>;
