import { z } from 'zod';
import {
  executionJobIdSchema,
  regionalExecutionIdempotencyKeySchema,
  regionalExecutionRequestSchema,
  regionalRuntimeMaxBatchSize
} from '@webperf/contracts';

export const regionalExecutionTargetLinkSchema = z.object({
  targetId: z.string().min(1).max(120),
  jobId: z.string().min(1).max(160),
  executionJobId: executionJobIdSchema
});
export type RegionalExecutionTargetLink = z.infer<typeof regionalExecutionTargetLinkSchema>;

export const regionalExecutionRecordSchema = z.object({
  id: regionalExecutionIdempotencyKeySchema,
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  request: regionalExecutionRequestSchema,
  targetLinks: z.array(regionalExecutionTargetLinkSchema)
    .min(1)
    .max(regionalRuntimeMaxBatchSize),
  acceptedAt: z.string().datetime(),
  deadlineAt: z.string().datetime(),
  cancelledAt: z.string().datetime().nullable(),
  deadlineExceededAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).superRefine((record, context) => {
  if (record.id !== record.request.idempotencyKey) {
    context.addIssue({
      code: 'custom',
      message: 'Regional execution record id must match its idempotency key',
      path: ['id']
    });
  }

  const requestTargetIds = record.request.targets.map((target) => target.targetId);
  const linkedTargetIds = record.targetLinks.map((target) => target.targetId);
  if (
    requestTargetIds.length !== linkedTargetIds.length
    || requestTargetIds.some((targetId, index) => targetId !== linkedTargetIds[index])
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Regional execution target links must preserve request target order',
      path: ['targetLinks']
    });
  }
});
export type RegionalExecutionRecord = z.infer<typeof regionalExecutionRecordSchema>;
