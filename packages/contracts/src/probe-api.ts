import { z } from 'zod';
import { probeMeasurementSchema } from './probe-model';
import { regionCodeSchema } from './regions';
import { customRequestConfigSchema } from './public-api';

export const probeApiPaths = ['/healthz', '/measure'] as const;

export const signedProbeMeasurementRequestSchema = z.object({
  jobId: z.string().min(1),
  targetId: z.string().min(1),
  region: regionCodeSchema,
  url: z.string().url(),
  request: customRequestConfigSchema.optional(),
  timestamp: z.string().datetime(),
  signature: z.string().min(16),
  keyVersion: z.enum(['current', 'next']).default('current')
});
export type SignedProbeMeasurementRequest = z.infer<typeof signedProbeMeasurementRequestSchema>;

export const probeMeasurementResponseSchema = z.object({
  measurement: probeMeasurementSchema
});
export type ProbeMeasurementResponse = z.infer<typeof probeMeasurementResponseSchema>;
