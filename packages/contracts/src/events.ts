import { z } from 'zod';
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

export const queueEventSchema = measurementQueuedEventSchema;
export type QueueEvent = z.infer<typeof queueEventSchema>;
