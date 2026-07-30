import { z } from 'zod';
import { runtimeLocationSchema } from './regions';

export const runtimeMetricsSchemaVersion = 1 as const;
export const runtimeTopology = 'single-replica-sqlite' as const;
export const executorConcurrency = 1 as const;

export const runtimeExecutionStatusCountsSchema = z.object({
  queued: z.number().int().nonnegative(),
  leased: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative()
});
export type RuntimeExecutionStatusCounts = z.infer<
  typeof runtimeExecutionStatusCountsSchema
>;

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
  byKind: z.object({
    network_probe: runtimeExecutionStatusCountsSchema,
    browser_audit: runtimeExecutionStatusCountsSchema,
    webhook_delivery: runtimeExecutionStatusCountsSchema
  })
});
export type RuntimeExecutionQueueMetrics = z.infer<
  typeof runtimeExecutionQueueMetricsSchema
>;

export const runtimeMetricsSchema = z.object({
  schemaVersion: z.literal(runtimeMetricsSchemaVersion),
  observedAt: z.string().datetime(),
  runtimeMode: z.enum(['full', 'regional-runtime']),
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
