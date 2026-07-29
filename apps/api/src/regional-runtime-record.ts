import { z } from 'zod';
import {
  executionJobIdSchema,
  regionalExecutionIdempotencyKeySchema,
  regionalExecutionProvenanceSchema,
  regionalExecutionRequestSchema,
  regionalExecutionSignatureSchema,
  regionalExecutionTargetSchema,
  regionalRuntimeMaxBatchSize
} from '@webperf/contracts';

export const regionalExecutionTargetLinkSchema = z.object({
  targetId: regionalExecutionTargetSchema.shape.targetId,
  jobId: executionJobIdSchema,
  executionJobId: executionJobIdSchema
});
export type RegionalExecutionTargetLink = z.infer<typeof regionalExecutionTargetLinkSchema>;

export const regionalExecutionRecordSchema = z.object({
  id: regionalExecutionIdempotencyKeySchema,
  requestDigest: regionalExecutionSignatureSchema,
  request: regionalExecutionRequestSchema,
  provenance: regionalExecutionProvenanceSchema,
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

  if (record.cancelledAt && record.deadlineExceededAt) {
    context.addIssue({
      code: 'custom',
      message: 'Regional execution cannot be both cancelled and deadline-exceeded',
      path: ['cancelledAt']
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
