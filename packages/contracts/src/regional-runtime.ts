import { z } from 'zod';
import { runtimeRegionIdSchema, runtimeRegionLabelSchema } from './regions';
import { probeImplementationSchema } from './probe-model';
import {
  requestBodyModeSchema,
  requestHeaderSchema,
  requestMethodSchema
} from './public-api';

/**
 * Regional runtime handoff protocol (Phase 4 of issue #14).
 *
 * This module defines a **provider-neutral** execution boundary that a
 * managed Cloud control plane can call to submit measurement work to one
 * regional runtime. The contracts are intentionally decoupled from the
 * self-host Check/Site/Region Set model so the Cloud can fan out global
 * runs across several regional runtimes without this repository importing
 * billing, tenancy, fleet scaling, or private orchestration.
 *
 * Protocol flow:
 *
 *   1. Cloud → POST /v1/regional-executions  (idempotent request)
 *   2. Runtime executes each target via its probe
 *   3. Cloud ← GET /v1/regional-executions/:id  (status poll)
 *   4. Cloud ← DELETE /v1/regional-executions/:id  (cancel)
 *
 * Version 1 intentionally supports network probes only. Browser Audit needs
 * a different target shape (policy, flow, artifact selection, and viewport)
 * and will be introduced as a separate discriminated request variant instead
 * of weakening this Fast Check boundary.
 */

export const regionalRuntimeProtocolVersion = 1 as const;
export const regionalRuntimeMaxBatchSize = 100;
export const regionalRuntimeMaxDeadlineMs = 900_000;
export const regionalRuntimeMaxAttempts = 20;
export const regionalExecutionPayloadMaxBytes = 1_500_000;
// Enforced by the regional execution POST handler before request HMAC
// verification. Exported so Cloud callers can use the same skew allowance.
export const regionalRuntimeReplayWindowSeconds = 300;
export const regionalExecutionSignatureSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const regionalExecutionIdempotencyKeySchema = z.string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  .max(160);
export const regionalRuntimeImageDigestSchema = z.string()
  .regex(/^sha256:[a-f0-9]{64}$/)
  .nullable()
  .default(null);
export const regionalRuntimeMetadataSchema = z.object({
  /** WebPerf runtime version (matches the immutable release metadata). */
  version: z.string().min(1).nullable().default(null),
  imageDigest: regionalRuntimeImageDigestSchema
});
export const regionalRunnerMetadataSchema = z.object({
  id: z.literal('probe-rs'),
  implementation: probeImplementationSchema,
  imageDigest: regionalRuntimeImageDigestSchema
});

// ---------------------------------------------------------------------------
// Capabilities discovery
// ---------------------------------------------------------------------------

export const regionalRuntimeRunnerTypeSchema = z.literal('network_probe');
export type RegionalRuntimeRunnerType = z.infer<typeof regionalRuntimeRunnerTypeSchema>;

export const regionalRuntimeCapabilitiesSchema = z.object({
  protocolVersion: z.literal(regionalRuntimeProtocolVersion),
  /** Fixed region identity this runtime measures from. */
  regionId: runtimeRegionIdSchema,
  regionLabel: runtimeRegionLabelSchema.optional(),
  /** Runner types this runtime can execute. */
  runnerTypes: z.array(regionalRuntimeRunnerTypeSchema).min(1),
  /** Maximum number of routes per execution request. */
  maxBatchSize: z.number().int().positive().max(regionalRuntimeMaxBatchSize),
  /** Maximum execution deadline in milliseconds. */
  maxDeadlineMs: z.number().int().positive().max(regionalRuntimeMaxDeadlineMs),
  /** Maximum retry attempts per target. */
  maxAttempts: z.number().int().positive().max(regionalRuntimeMaxAttempts),
  runtime: regionalRuntimeMetadataSchema,
  runner: regionalRunnerMetadataSchema
});
export type RegionalRuntimeCapabilities = z.infer<typeof regionalRuntimeCapabilitiesSchema>;

// ---------------------------------------------------------------------------
// Execution request (Cloud → Runtime)
// ---------------------------------------------------------------------------

export const regionalExecutionRequestBodySchema = z.strictObject({
  mode: requestBodyModeSchema,
  contentType: z.string().min(1).max(120).nullable(),
  value: z.string().max(10_000)
});
export const regionalExecutionRequestConfigSchema = z.strictObject({
  method: requestMethodSchema,
  headers: z.array(requestHeaderSchema).max(20),
  body: regionalExecutionRequestBodySchema.nullable()
}).superRefine((value, context) => {
  if ((value.method === 'GET' || value.method === 'HEAD') && value.body != null) {
    context.addIssue({
      code: 'custom',
      message: `${value.method} requests cannot include a request body`,
      path: ['body']
    });
  }
});

export const regionalExecutionTargetSchema = z.strictObject({
  targetId: z.string().min(1).max(120),
  url: z.string().url(),
  /** Optional request overrides shared with the public Fast Check contract. */
  request: regionalExecutionRequestConfigSchema.optional()
});
export type RegionalExecutionTarget = z.infer<typeof regionalExecutionTargetSchema>;

export const regionalExecutionRequestSchema = z.strictObject({
  /** Idempotency key — the runtime deduplicates requests with the same key. */
  idempotencyKey: regionalExecutionIdempotencyKeySchema,
  /** Runner type for this batch. */
  runnerType: regionalRuntimeRunnerTypeSchema,
  /** Bounded route batch (1–100 targets). */
  targets: z.array(regionalExecutionTargetSchema).min(1).max(regionalRuntimeMaxBatchSize),
  /** Execution deadline in milliseconds from acceptance. */
  deadlineMs: z.number().int().positive().max(regionalRuntimeMaxDeadlineMs),
  /** Maximum retry attempts per target. */
  maxAttempts: z.number().int().positive().max(regionalRuntimeMaxAttempts),
  /** Request timestamp for replay protection (RFC 3339). */
  timestamp: z.string().datetime(),
  /** HMAC-SHA256 signature over the canonical request payload. */
  signature: regionalExecutionSignatureSchema,
  /** Which signing key produced the signature. */
  keyVersion: z.enum(['current', 'next'])
}).superRefine((request, context) => {
  const seen = new Set<string>();
  for (const [index, target] of request.targets.entries()) {
    if (seen.has(target.targetId)) {
      context.addIssue({
        code: 'custom',
        message: 'Regional execution target ids must be unique',
        path: ['targets', index, 'targetId']
      });
    }
    seen.add(target.targetId);
  }
});
export type RegionalExecutionRequest = z.infer<typeof regionalExecutionRequestSchema>;

// ---------------------------------------------------------------------------
// Execution status (Runtime → Cloud)
// ---------------------------------------------------------------------------

export const regionalExecutionStatusValues = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled'
] as const;
export const regionalExecutionStatusSchema = z.enum(regionalExecutionStatusValues);
export type RegionalExecutionStatus = z.infer<typeof regionalExecutionStatusSchema>;

export const regionalExecutionTargetResultSchema = z.object({
  targetId: z.string().min(1).max(120),
  status: regionalExecutionStatusSchema,
  region: runtimeRegionIdSchema,
  latencyMs: z.number().int().nonnegative().nullable().default(null),
  statusCode: z.number().int().min(100).max(599).nullable().default(null),
  success: z.boolean().nullable().default(null),
  errorCode: z.string().min(1).max(120).nullable().default(null),
  errorMessage: z.string().min(1).max(1_000).nullable().default(null),
  startedAt: z.string().datetime().nullable().default(null),
  finishedAt: z.string().datetime().nullable().default(null)
});
export type RegionalExecutionTargetResult = z.infer<typeof regionalExecutionTargetResultSchema>;

export const regionalExecutionProvenanceSchema = z.object({
  regionId: runtimeRegionIdSchema,
  runnerType: regionalRuntimeRunnerTypeSchema,
  runtime: regionalRuntimeMetadataSchema,
  runner: regionalRunnerMetadataSchema
});
export type RegionalExecutionProvenance = z.infer<typeof regionalExecutionProvenanceSchema>;

export const regionalExecutionResultSchema = z.object({
  idempotencyKey: regionalExecutionIdempotencyKeySchema,
  status: regionalExecutionStatusSchema,
  targets: z.array(regionalExecutionTargetResultSchema)
    .min(1)
    .max(regionalRuntimeMaxBatchSize),
  provenance: regionalExecutionProvenanceSchema,
  acceptedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable().default(null),
  /** HMAC-SHA256 signature over the canonical result payload. */
  signature: regionalExecutionSignatureSchema,
  keyVersion: z.enum(['current', 'next'])
});
export type RegionalExecutionResult = z.infer<typeof regionalExecutionResultSchema>;

// ---------------------------------------------------------------------------
// Signed payload helpers (mirror the probe signature pattern)
// ---------------------------------------------------------------------------

/**
 * Fields that form the canonical signing payload for a regional execution
 * request. The array is alphabetical to match `stableStringify`, which
 * canonicalizes object keys before HMAC-SHA256 signing.
 */
export const regionalExecutionSignatureFields = [
  'deadlineMs',
  'idempotencyKey',
  'keyVersion',
  'maxAttempts',
  'runnerType',
  'targets',
  'timestamp'
] as const;

/**
 * Fields that form the canonical signing payload for a regional execution
 * result. The array is alphabetical to match `stableStringify`, which the
 * runtime uses before returning the HMAC-SHA256 signature to the Cloud.
 */
export const regionalResultSignatureFields = [
  'acceptedAt',
  'completedAt',
  'idempotencyKey',
  'keyVersion',
  'provenance',
  'status',
  'targets'
] as const;
