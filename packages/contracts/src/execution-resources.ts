import { z } from 'zod';
import {
  enqueueExecutionJobSchema,
  executionJobSchema,
  executionJobOwnerRequestSchema,
  jsonValueSchema
} from './execution';
import {
  browserAuditResourceSchema,
  checkProfileAlertDeliverySchema,
  checkProfileRunSchema,
  checkProfileSchema,
  latencyJobDetailSchema,
  webhookAlertTargetSchema
} from './public-api';
import { browserAuditArtifactUploadConfigSchema } from './browser-audit';

export const networkProbeMaxJobsPerExecution = 20;
export const executionFollowupMaxJobs = 20;

export const networkProbeExecutionPayloadSchema = z
  .object({
    version: z.literal('v1'),
    jobIds: z.array(z.string().min(1).max(160))
      .min(1)
      .max(networkProbeMaxJobsPerExecution),
    checkId: z.string().min(1).max(160).nullable().default(null),
    runId: z.string().min(1).max(160).nullable().default(null)
  })
  .superRefine((payload, context) => {
    if (Boolean(payload.checkId) !== Boolean(payload.runId)) {
      context.addIssue({
        code: 'custom',
        message: 'checkId and runId must either both be present or both be null',
        path: ['runId']
      });
    }
  });
export type NetworkProbeExecutionPayload = z.infer<typeof networkProbeExecutionPayloadSchema>;

export const browserAuditExecutionPayloadSchema = z.object({
  version: z.literal('v1'),
  auditId: z.string().min(1).max(160)
});
export type BrowserAuditExecutionPayload = z.infer<typeof browserAuditExecutionPayloadSchema>;

export const webhookDeliveryExecutionPayloadSchema = z.object({
  version: z.literal('v1'),
  runId: z.string().min(1).max(160),
  target: webhookAlertTargetSchema,
  body: jsonValueSchema
});
export type WebhookDeliveryExecutionPayload = z.infer<typeof webhookDeliveryExecutionPayloadSchema>;

export const executionResourceContextRequestSchema = executionJobOwnerRequestSchema;
export type ExecutionResourceContextRequest = z.infer<typeof executionResourceContextRequestSchema>;

export const networkProbeExecutionContextSchema = z
  .object({
    kind: z.literal('network_probe'),
    executionJob: executionJobSchema,
    payload: networkProbeExecutionPayloadSchema,
    jobs: z.array(latencyJobDetailSchema)
      .min(1)
      .max(networkProbeMaxJobsPerExecution),
    check: checkProfileSchema.nullable(),
    run: checkProfileRunSchema.nullable(),
    comparedRun: checkProfileRunSchema.nullable(),
    comparedJobs: z.array(latencyJobDetailSchema).max(networkProbeMaxJobsPerExecution),
    comparisonMode: z.enum(['baseline', 'latest_previous']).nullable()
  })
  .superRefine((contextValue, issueContext) => {
    const hasComparison = contextValue.comparisonMode !== null;

    if (hasComparison !== (contextValue.comparedRun !== null)) {
      issueContext.addIssue({
        code: 'custom',
        message: 'comparisonMode and comparedRun must either both be present or both be null',
        path: ['comparedRun']
      });
    }

    if (hasComparison === (contextValue.comparedJobs.length === 0)) {
      issueContext.addIssue({
        code: 'custom',
        message: hasComparison
          ? 'comparedJobs must contain at least one job when comparisonMode is set'
          : 'comparedJobs must be empty when comparisonMode is null',
        path: ['comparedJobs']
      });
    }
  });

const browserAuditExecutionContextSchema = z.object({
  kind: z.literal('browser_audit'),
  executionJob: executionJobSchema,
  payload: browserAuditExecutionPayloadSchema,
  audit: browserAuditResourceSchema
});

const webhookDeliveryExecutionContextSchema = z.object({
  kind: z.literal('webhook_delivery'),
  executionJob: executionJobSchema,
  payload: webhookDeliveryExecutionPayloadSchema,
  run: checkProfileRunSchema
});

export const executionResourceContextSchema = z.discriminatedUnion('kind', [
  networkProbeExecutionContextSchema,
  browserAuditExecutionContextSchema,
  webhookDeliveryExecutionContextSchema
]);
export type ExecutionResourceContext = z.infer<typeof executionResourceContextSchema>;

export const browserAuditArtifactUploadGrantRequestSchema = executionJobOwnerRequestSchema;
export type BrowserAuditArtifactUploadGrantRequest = z.infer<
  typeof browserAuditArtifactUploadGrantRequestSchema
>;
export const browserAuditArtifactUploadGrantSchema = browserAuditArtifactUploadConfigSchema;

const networkProbeExecutionResultSchema = z.object({
  kind: z.literal('network_probe'),
  jobs: z.array(latencyJobDetailSchema)
    .min(1)
    .max(networkProbeMaxJobsPerExecution),
  run: checkProfileRunSchema.nullable()
});

const browserAuditExecutionResultSchema = z.object({
  kind: z.literal('browser_audit'),
  audit: browserAuditResourceSchema
});

const webhookDeliveryExecutionResultSchema = z.object({
  kind: z.literal('webhook_delivery'),
  runId: z.string().min(1).max(160),
  delivery: checkProfileAlertDeliverySchema
});

export const executionResourceResultSchema = z.discriminatedUnion('kind', [
  networkProbeExecutionResultSchema,
  browserAuditExecutionResultSchema,
  webhookDeliveryExecutionResultSchema
]);
export type ExecutionResourceResult = z.infer<typeof executionResourceResultSchema>;

export const executionResourceResultRequestSchema = executionJobOwnerRequestSchema.extend({
  result: executionResourceResultSchema
});
export type ExecutionResourceResultRequest = z.infer<typeof executionResourceResultRequestSchema>;

export const executionFollowupsRequestSchema = executionJobOwnerRequestSchema.extend({
  jobs: z.array(enqueueExecutionJobSchema)
    .min(1)
    .max(executionFollowupMaxJobs)
});
export type ExecutionFollowupsRequest = z.infer<typeof executionFollowupsRequestSchema>;

export const executionFollowupsResponseSchema = z.object({
  jobs: z.array(executionJobSchema)
    .min(1)
    .max(executionFollowupMaxJobs)
});
export type ExecutionFollowupsResponse = z.infer<typeof executionFollowupsResponseSchema>;
