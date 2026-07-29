import { z } from 'zod';
import {
  executionJobIdSchema,
  latencyJobIdSchema,
  regionalExecutionIdempotencyKeySchema,
  regionalExecutionProvenanceSchema,
  regionalExecutionRequestSchema,
  regionalExecutionSignatureSchema,
  regionalExecutionTargetSchema,
  regionalRuntimeMaxBatchSize
} from '@webperf/contracts';

export const regionalExecutionTargetLinkSchema = z.object({
  targetId: regionalExecutionTargetSchema.shape.targetId,
  jobId: latencyJobIdSchema,
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

  const acceptedAtMs = Date.parse(record.acceptedAt);
  const deadlineAtMs = Date.parse(record.deadlineAt);
  const createdAtMs = Date.parse(record.createdAt);
  const updatedAtMs = Date.parse(record.updatedAt);
  if (deadlineAtMs <= acceptedAtMs) {
    context.addIssue({
      code: 'custom',
      message: 'Regional execution deadline must follow acceptance',
      path: ['deadlineAt']
    });
  }
  if (updatedAtMs < createdAtMs) {
    context.addIssue({
      code: 'custom',
      message: 'Regional execution update must not precede creation',
      path: ['updatedAt']
    });
  }
  for (const terminalField of ['cancelledAt', 'deadlineExceededAt'] as const) {
    const terminalAt = record[terminalField];
    if (
      terminalAt !== null
      && (
        Date.parse(terminalAt) < acceptedAtMs
        || Date.parse(terminalAt) > updatedAtMs
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Regional execution terminal time must fall between acceptance and its last update',
        path: [terminalField]
      });
    }
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
