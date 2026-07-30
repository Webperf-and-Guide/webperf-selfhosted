import { z } from 'zod';
import { probeImplementationSchema, probeMeasurementSchema } from './probe-model';
import { runtimeRegionIdSchema } from './regions';
import { customRequestConfigSchema } from './public-api';
import { boundedJobIdSchema, boundedTargetIdSchema } from './identifiers';

const probeTargetUrlSchema = z
  .string()
  .max(8_192)
  .url()
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Probe targets must use http or https');

export const probeProtocolVersion = 1 as const;
export const probeTransportMaxPayloadBytes = 2 * 1_024 * 1_024;
export const probeDefaultMaxInflight = 64;
export const probeMaxConfiguredInflight = 4_096;
export const probeMeasurementTimeoutMs = 40_000;

export const probeApiPaths = ['/healthz', '/capabilities', '/measure'] as const;

export const signedProbeMeasurementRequestSchema = z.object({
  jobId: boundedJobIdSchema,
  targetId: boundedTargetIdSchema,
  region: runtimeRegionIdSchema,
  url: probeTargetUrlSchema,
  request: customRequestConfigSchema.optional(),
  timestamp: z.string().datetime(),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
  keyVersion: z.enum(['current', 'next']).default('current')
});
export type SignedProbeMeasurementRequest = z.infer<typeof signedProbeMeasurementRequestSchema>;

export const probeRuntimeProvenanceSchema = z.object({
  implementation: probeImplementationSchema,
  version: z.string().min(1).max(120).nullable(),
  imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable()
});
export type ProbeRuntimeProvenance = z.infer<typeof probeRuntimeProvenanceSchema>;

export const probeCapabilitiesSchema = z.object({
  protocolVersion: z.literal(probeProtocolVersion),
  region: runtimeRegionIdSchema,
  provenance: probeRuntimeProvenanceSchema,
  limits: z.object({
    maxInflight: z.number().int().min(1).max(probeMaxConfiguredInflight),
    maxPayloadBytes: z.literal(probeTransportMaxPayloadBytes),
    measurementTimeoutMs: z.literal(probeMeasurementTimeoutMs)
  })
});
export type ProbeCapabilities = z.infer<typeof probeCapabilitiesSchema>;

export const probeMeasurementResponseSchema = z.object({
  jobId: boundedJobIdSchema.optional(),
  targetId: boundedTargetIdSchema.optional(),
  provenance: probeRuntimeProvenanceSchema.optional(),
  measurement: probeMeasurementSchema
});
export type ProbeMeasurementResponse = z.infer<typeof probeMeasurementResponseSchema>;
