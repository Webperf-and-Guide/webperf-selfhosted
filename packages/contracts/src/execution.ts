import { z } from 'zod';

export const executionJobKindSchema = z.enum([
  'network_probe',
  'browser_audit',
  'webhook_delivery'
]);
export type ExecutionJobKind = z.infer<typeof executionJobKindSchema>;

export const executionJobStatusSchema = z.enum([
  'queued',
  'leased',
  'running',
  'succeeded',
  'failed',
  'cancelled'
]);
export type ExecutionJobStatus = z.infer<typeof executionJobStatusSchema>;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number(), z.string(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)])
);

export const executionJobErrorSchema = z.object({
  code: z.string().min(1).max(120),
  message: z.string().min(1).max(1_000),
  retryable: z.boolean()
});
export type ExecutionJobError = z.infer<typeof executionJobErrorSchema>;

export const executionJobSchema = z.object({
  id: z.string().min(1).max(160),
  kind: executionJobKindSchema,
  resourceId: z.string().min(1).max(160),
  status: executionJobStatusSchema,
  leaseOwner: z.string().min(1).max(160).nullable(),
  leaseExpiresAt: z.string().datetime().nullable(),
  attemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive().max(20),
  availableAt: z.string().datetime(),
  payload: jsonValueSchema,
  error: executionJobErrorSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable()
});
export type ExecutionJob = z.infer<typeof executionJobSchema>;

export const enqueueExecutionJobSchema = z.object({
  id: z.string().min(1).max(160),
  kind: executionJobKindSchema,
  resourceId: z.string().min(1).max(160),
  maxAttempts: z.number().int().positive().max(20).default(3),
  availableAt: z.string().datetime().optional(),
  payload: jsonValueSchema
});
export type EnqueueExecutionJob = z.infer<typeof enqueueExecutionJobSchema>;
