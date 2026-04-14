import { z } from 'zod';
import { emptyStringToUndefined } from './shared';

export const webEnvSchema = z
  .object({
    CONTROL_BASE_URL: emptyStringToUndefined(z.string().url()),
    DEPLOY_TARGET: z.enum(['pages', 'workers']).default('pages'),
    TURNSTILE_SITE_KEY: emptyStringToUndefined(z.string().min(1))
  })
  .transform((input) => ({
    CONTROL_BASE_URL: input.CONTROL_BASE_URL ?? 'http://127.0.0.1:8788',
    DEPLOY_TARGET: input.DEPLOY_TARGET,
    TURNSTILE_SITE_KEY: input.TURNSTILE_SITE_KEY
  }));

export const parseWebEnv = (
  input: Partial<
    Record<
      'CONTROL_BASE_URL' | 'DEPLOY_TARGET' | 'TURNSTILE_SITE_KEY',
      string | undefined
    >
  >
) =>
  webEnvSchema.parse({
    CONTROL_BASE_URL: input.CONTROL_BASE_URL,
    DEPLOY_TARGET: input.DEPLOY_TARGET,
    TURNSTILE_SITE_KEY: input.TURNSTILE_SITE_KEY
  });
