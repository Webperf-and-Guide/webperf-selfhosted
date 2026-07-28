import { z } from 'zod';
import { runtimeRegionIdSchema, runtimeRegionLabelSchema } from './regions';
import { probeImplementationSchema } from './probe-model';

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
 * Authentication uses the same HMAC-SHA256 current/next key rotation as
 * the probe `/measure` endpoint, applied to a canonical JSON payload.
 */

// ---------------------------------------------------------------------------
// Capabilities discovery
// ---------------------------------------------------------------------------

export const regionalRuntimeRunnerTypeSchema = z.enum(['network_probe', 'browser_audit']);
export type RegionalRuntimeRunnerType = z.infer<typeof regionalRuntimeRunnerTypeSchema>;

export const regionalRuntimeCapabilitiesSchema = z.object({
  /** Fixed region identity this runtime measures from. */
  regionId: runtimeRegionIdSchema,
  regionLabel: runtimeRegionLabelSchema.optional(),
  /** Runner types this runtime can execute. */
  runnerTypes: z.array(regionalRuntimeRunnerTypeSchema).min(1),
  /** Maximum number of routes per execution request. */
  maxBatchSize: z.number().int().positive().max(100),
  /** Maximum execution deadline in milliseconds. */
  maxDeadlineMs: z.number().int().positive().max(86_400_000),
  /** Maximum retry attempts per target. */
  maxAttempts: z.number().int().positive().max(20),
  /** Probe implementation version reported in result provenance. */
  probeImpl: probeImplementationSchema,
  /** Runtime image digest for toolchain provenance. */
  imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable().default(null),
  /** WebPerf runtime version (matches VERSION file). */
  runtimeVersion: z.string().min(1).nullable().default(null)
});
export type RegionalRuntimeCapabilities = z.infer<typeof regionalRuntimeCapabilitiesSchema>;

// ---------------------------------------------------------------------------
// Execution request (Cloud → Runtime)
// ---------------------------------------------------------------------------

export const regionalExecutionTargetSchema = z.object({
  targetId: z.string().min(1).max(120),
  url: z.string().url(),
  /** Optional request overrides (method, headers, body). */
  method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']).default('GET'),
  headers: z.array(z.object({
    name: z.string().min(1).max(120),
    value: z.string().max(8192)
  })).max(20).default([])
});
export type RegionalExecutionTarget = z.infer<typeof regionalExecutionTargetSchema>;

export const regionalExecutionRequestSchema = z.strictObject({
  /** Idempotency key — the runtime deduplicates requests with the same key. */
  idempotencyKey: z.string().min(1).max(200),
  /** Runner type for this batch. */
  runnerType: regionalRuntimeRunnerTypeSchema,
  /** Bounded route batch (1–100 targets). */
  targets: z.array(regionalExecutionTargetSchema).min(1).max(100),
  /** Execution deadline in milliseconds from acceptance. */
  deadlineMs: z.number().int().positive().max(86_400_000),
  /** Maximum retry attempts per target. */
  maxAttempts: z.number().int().positive().max(20).default(3),
  /** Request timestamp for replay protection (RFC 3339). */
  timestamp: z.string().datetime(),
  /** HMAC-SHA256 signature over the canonical request payload. */
  signature: z.string().min(16),
  /** Which signing key produced the signature. */
  keyVersion: z.enum(['current', 'next'])
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
  targetId: z.string().min(1),
  status: regionalExecutionStatusSchema,
  region: runtimeRegionIdSchema,
  latencyMs: z.number().int().nonnegative().nullable().default(null),
  statusCode: z.number().int().min(100).max(599).nullable().default(null),
  success: z.boolean().nullable().default(null),
  errorCode: z.string().min(1).nullable().default(null),
  errorMessage: z.string().min(1).nullable().default(null),
  startedAt: z.string().datetime().nullable().default(null),
  finishedAt: z.string().datetime().nullable().default(null)
});
export type RegionalExecutionTargetResult = z.infer<typeof regionalExecutionTargetResultSchema>;

export const regionalExecutionProvenanceSchema = z.object({
  regionId: runtimeRegionIdSchema,
  runnerType: regionalRuntimeRunnerTypeSchema,
  probeImpl: probeImplementationSchema.nullable().default(null),
  runtimeVersion: z.string().min(1).nullable().default(null),
  imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable().default(null)
});
export type RegionalExecutionProvenance = z.infer<typeof regionalExecutionProvenanceSchema>;

export const regionalExecutionResultSchema = z.object({
  idempotencyKey: z.string().min(1),
  status: regionalExecutionStatusSchema,
  targets: z.array(regionalExecutionTargetResultSchema),
  provenance: regionalExecutionProvenanceSchema,
  acceptedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable().default(null),
  /** HMAC-SHA256 signature over the canonical result payload. */
  signature: z.string().min(16),
  keyVersion: z.enum(['current', 'next'])
});
export type RegionalExecutionResult = z.infer<typeof regionalExecutionResultSchema>;

// ---------------------------------------------------------------------------
// Signed payload helpers (mirror the probe signature pattern)
// ---------------------------------------------------------------------------

/**
 * Fields that form the canonical signing payload for a regional execution
 * request. The Cloud control plane serializes these in the same stable
 * key order and signs with HMAC-SHA256.
 */
export const regionalExecutionSignatureFields = [
  'idempotencyKey',
  'runnerType',
  'targets',
  'deadlineMs',
  'maxAttempts',
  'timestamp'
] as const;

/**
 * Fields that form the canonical signing payload for a regional execution
 * result. The runtime serializes these and signs with HMAC-SHA256 before
 * returning to the Cloud control plane.
 */
export const regionalResultSignatureFields = [
  'idempotencyKey',
  'status',
  'targets',
  'provenance',
  'acceptedAt',
  'completedAt'
] as const;
