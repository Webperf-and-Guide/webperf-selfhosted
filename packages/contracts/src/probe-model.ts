import { z } from 'zod';
import { regionCodeSchema } from './regions';

export const probeImplementationValues = ['go', 'rust'] as const;
export const probeImplementationSchema = z.enum(probeImplementationValues);
export type ProbeImplementation = z.infer<typeof probeImplementationSchema>;

const nullableTimingSchema = z.number().nonnegative().nullable();

export const probeTimingsSchema = z.object({
  totalMs: z.number().nonnegative(),
  dnsMs: nullableTimingSchema,
  tcpMs: nullableTimingSchema,
  tlsMs: nullableTimingSchema,
  ttfbMs: nullableTimingSchema
});
export type ProbeTimings = z.infer<typeof probeTimingsSchema>;

export const probeTlsMetadataSchema = z.object({
  version: z.string().min(1).nullable(),
  alpn: z.string().min(1).nullable(),
  cipherSuite: z.string().min(1).nullable(),
  serverName: z.string().min(1).nullable()
});
export type ProbeTlsMetadata = z.infer<typeof probeTlsMetadataSchema>;

export const probeMeasurementSchema = z.object({
  region: regionCodeSchema,
  url: z.string().url(),
  latencyMs: z.number().nonnegative(),
  measuredAt: z.string().datetime(),
  statusCode: z.number().int().min(100).max(599).nullable(),
  success: z.boolean(),
  probeImpl: probeImplementationSchema,
  finalUrl: z.string().url().nullable(),
  redirectCount: z.number().int().nonnegative(),
  timings: probeTimingsSchema,
  tls: probeTlsMetadataSchema.nullable(),
  error: z.string().min(1).nullable()
});
export type ProbeMeasurement = z.infer<typeof probeMeasurementSchema>;
