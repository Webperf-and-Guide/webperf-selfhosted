import { z } from 'zod';

export const selfhostSchedulerEnvSchema = z.object({
  SELFHOST_SCHEDULER_API_BASE_URL: z.string().url().default('http://127.0.0.1:8788'),
  SELFHOST_SCHEDULER_POLL_INTERVAL_SECONDS: z.preprocess(
    (value) => value ?? '60',
    z.coerce.number().int().positive()
  )
});

export const parseSelfhostSchedulerVars = (
  input: Partial<
    Record<keyof z.infer<typeof selfhostSchedulerEnvSchema>, string | number | undefined>
  >
) =>
  selfhostSchedulerEnvSchema.parse({
    SELFHOST_SCHEDULER_API_BASE_URL: input.SELFHOST_SCHEDULER_API_BASE_URL,
    SELFHOST_SCHEDULER_POLL_INTERVAL_SECONDS: input.SELFHOST_SCHEDULER_POLL_INTERVAL_SECONDS
  });
