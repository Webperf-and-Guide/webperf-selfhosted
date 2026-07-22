import { z } from 'zod';

export const selfhostSchedulerEnvSchema = z
  .object({
    SELFHOST_SCHEDULER_API_BASE_URL: z.string().url().default('http://127.0.0.1:8788'),
    SELFHOST_INTERNAL_SECRET: z.string().trim().min(16),
    SELFHOST_SCHEDULER_POLL_INTERVAL_SECONDS: z.preprocess(
      (value) => value ?? '60',
      z.coerce.number().int().positive().max(86_400)
    )
  })
  .superRefine((config, context) => {
    const apiUrl = new URL(config.SELFHOST_SCHEDULER_API_BASE_URL);

    if (
      !['http:', 'https:'].includes(apiUrl.protocol)
      || apiUrl.username
      || apiUrl.password
      || apiUrl.pathname !== '/'
      || apiUrl.search
      || apiUrl.hash
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Scheduler API URL must be an HTTP(S) origin without path, credentials, query, or fragment',
        path: ['SELFHOST_SCHEDULER_API_BASE_URL']
      });
    }
  });

export const parseSelfhostSchedulerVars = (
  input: Partial<
    Record<keyof z.infer<typeof selfhostSchedulerEnvSchema>, string | number | undefined>
  >
) =>
  selfhostSchedulerEnvSchema.parse({
    SELFHOST_SCHEDULER_API_BASE_URL: input.SELFHOST_SCHEDULER_API_BASE_URL,
    SELFHOST_INTERNAL_SECRET: input.SELFHOST_INTERNAL_SECRET,
    SELFHOST_SCHEDULER_POLL_INTERVAL_SECONDS: input.SELFHOST_SCHEDULER_POLL_INTERVAL_SECONDS
  });
