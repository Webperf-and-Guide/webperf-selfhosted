import { z } from 'zod';
import { boundedJobIdSchema } from './identifiers';

export const executionJobIdSchema = boundedJobIdSchema;

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

export const executionPayloadMaxDepth = 32;
export const executionPayloadMaxBytes = 256 * 1_024;
export const defaultExecutionRetryDelayMs = 1_000;
export const executionJobMaxAttempts = 20;
export const executionLeaseOwnerMaxLength = 160;
export const executionLeaseDurationMinMs = 1_000;
export const executionLeaseDurationMaxMs = 3_600_000;
export const executionRetryDelayMaxMs = 86_400_000;
export const executionAvailabilityMaxDelayDays = 7;
export const executionAvailabilityMaxDelayMs =
  executionAvailabilityMaxDelayDays * 24 * 60 * 60 * 1_000;
export const executionErrorCodeMaxLength = 120;
export const executionErrorMessageMaxLength = 1_000;
const utf8Encoder = new TextEncoder();
const reservedJsonObjectKeys = new Set(['__proto__', 'constructor', 'prototype']);

const jsonLiteralSchema = z.union([z.null(), z.boolean(), z.number(), z.string()]);

const createJsonValueSchema = (depth: number): z.ZodType<JsonValue> => {
  if (depth >= executionPayloadMaxDepth) {
    return jsonLiteralSchema;
  }

  const childSchema = createJsonValueSchema(depth + 1);
  const objectSchema = z
    .custom<Record<string, unknown>>(isSafeJsonRecord, {
      message: 'JSON objects must not contain reserved keys or custom prototypes'
    })
    .pipe(z.record(z.string(), childSchema));
  return z.union([
    jsonLiteralSchema,
    z.array(childSchema),
    objectSchema
  ]);
};

const isSafeJsonRecord = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null)
    && !Object.keys(value).some((key) => reservedJsonObjectKeys.has(key))
  );
};

const rawJsonValueSchema = createJsonValueSchema(0);

export const jsonValueSchema = rawJsonValueSchema.superRefine((value, context) => {
  // This public contract accepts an in-memory JSON value rather than raw body
  // bytes. Serializing once is therefore the authoritative way to enforce the
  // exact UTF-8 wire-size limit, including escaping and surrogate handling.
  const serialized = JSON.stringify(value);
  const byteSize = utf8Encoder.encode(serialized).byteLength;

  if (byteSize > executionPayloadMaxBytes) {
    context.addIssue({
      code: 'custom',
      message: `JSON payload must not exceed ${executionPayloadMaxBytes} bytes`
    });
  }
});

export const executionJobErrorSchema = z.object({
  code: z.string().min(1).max(executionErrorCodeMaxLength),
  message: z.string().min(1).max(executionErrorMessageMaxLength),
  retryable: z.boolean()
});
export type ExecutionJobError = z.infer<typeof executionJobErrorSchema>;

export const executionJobSchema = z
  .object({
    id: executionJobIdSchema,
    kind: executionJobKindSchema,
    resourceId: executionJobIdSchema,
    status: executionJobStatusSchema,
    leaseOwner: z.string().min(1).max(executionLeaseOwnerMaxLength).nullable(),
    leaseExpiresAt: z.string().datetime().nullable(),
    attemptCount: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive().max(executionJobMaxAttempts),
    availableAt: z.string().datetime(),
    payload: jsonValueSchema,
    error: executionJobErrorSchema.nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable()
  })
  .refine((job) => job.attemptCount <= job.maxAttempts, {
    message: 'attemptCount must not exceed maxAttempts',
    path: ['attemptCount']
  })
  .superRefine((job, context) => {
    const leased = job.status === 'leased' || job.status === 'running';
    const terminal = job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled';

    if (leased && (!job.leaseOwner || !job.leaseExpiresAt)) {
      context.addIssue({
        code: 'custom',
        message: 'leased and running jobs require an owner and expiry',
        path: ['leaseOwner']
      });
    }

    if (!leased && (job.leaseOwner || job.leaseExpiresAt)) {
      context.addIssue({
        code: 'custom',
        message: 'only leased and running jobs may retain lease metadata',
        path: ['leaseOwner']
      });
    }

    if (terminal !== Boolean(job.completedAt)) {
      context.addIssue({
        code: 'custom',
        message: terminal
          ? 'terminal jobs require completedAt'
          : 'non-terminal jobs must not have completedAt',
        path: ['completedAt']
      });
    }
  });
export type ExecutionJob = z.infer<typeof executionJobSchema>;

export const enqueueExecutionJobSchema = z.object({
  id: executionJobIdSchema,
  kind: executionJobKindSchema,
  resourceId: executionJobIdSchema,
  maxAttempts: z.number().int().positive().max(executionJobMaxAttempts).default(3),
  availableAt: z.string().datetime().optional(),
  payload: jsonValueSchema
});
export type EnqueueExecutionJob = z.infer<typeof enqueueExecutionJobSchema>;

export const executionJobLeaseRequestSchema = z.object({
  leaseOwner: z.string().min(1).max(executionLeaseOwnerMaxLength),
  leaseDurationMs: z
    .number()
    .int()
    .min(executionLeaseDurationMinMs)
    .max(executionLeaseDurationMaxMs)
});
export type ExecutionJobLeaseRequest = z.infer<typeof executionJobLeaseRequestSchema>;

export const executionJobOwnerRequestSchema = z.object({
  leaseOwner: z.string().min(1).max(executionLeaseOwnerMaxLength)
});
export type ExecutionJobOwnerRequest = z.infer<typeof executionJobOwnerRequestSchema>;

export const executionJobFailRequestSchema = executionJobOwnerRequestSchema.extend({
  error: executionJobErrorSchema,
  retryDelayMs: z
    .number()
    .int()
    .min(0)
    .max(executionRetryDelayMaxMs)
    .optional()
    .describe(
      `Delay before a retry becomes claimable; defaults to ${defaultExecutionRetryDelayMs}ms when omitted.`
    )
});
export type ExecutionJobFailRequest = z.infer<typeof executionJobFailRequestSchema>;
