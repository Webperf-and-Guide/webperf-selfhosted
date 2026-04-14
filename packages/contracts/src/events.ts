import { z } from 'zod';
import {
  browserAuditCookieSchema,
  browserAuditExecutionStatusSchema,
  browserAuditHeaderSchema,
  browserAuditPolicySchema
} from './browser-audit';
import { probeImplementationSchema } from './probe-model';
import { regionCodeSchema } from './regions';

export const measurementQueuedEventSchema = z.object({
  type: z.literal('measurement.queued'),
  jobId: z.string().min(1),
  targetId: z.string().min(1),
  region: regionCodeSchema,
  url: z.string().url()
});
export type MeasurementQueuedEvent = z.infer<typeof measurementQueuedEventSchema>;

export const browserAuditQueuedEventSchema = z.object({
  type: z.literal('browser_audit.queued'),
  executionId: z.string().min(1),
  profileId: z.string().min(1).nullable().default(null),
  runId: z.string().min(1).nullable().default(null),
  routeId: z.string().min(1).nullable().default(null),
  jobId: z.string().min(1).nullable().default(null),
  region: regionCodeSchema.nullable().default(null),
  url: z.string().url(),
  policy: browserAuditPolicySchema,
  customHeaders: z.array(browserAuditHeaderSchema).max(20).default([]),
  cookies: z.array(browserAuditCookieSchema).max(20).default([]),
  status: browserAuditExecutionStatusSchema.default('queued')
});
export type BrowserAuditQueuedEvent = z.infer<typeof browserAuditQueuedEventSchema>;

export const bunnySmokeResultSchema = z.object({
  type: z.literal('bunny.smoke'),
  ok: z.boolean(),
  region: regionCodeSchema,
  slotId: z.string().min(1),
  probeImpl: probeImplementationSchema,
  measuredAt: z.string().datetime(),
  detail: z.string().min(1)
});
export type BunnySmokeResult = z.infer<typeof bunnySmokeResultSchema>;

export const queueEventSchema = z.discriminatedUnion('type', [
  measurementQueuedEventSchema,
  browserAuditQueuedEventSchema
]);
export type QueueEvent = z.infer<typeof queueEventSchema>;
