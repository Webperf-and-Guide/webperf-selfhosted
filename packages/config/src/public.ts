import { z } from 'zod';
import { emptyStringToUndefined } from './shared';
export const webEnvSchema = z
  .object({
    CONTROL_BASE_URL: emptyStringToUndefined(z.string().url())
  })
  .transform((input) => ({
    CONTROL_BASE_URL: input.CONTROL_BASE_URL ?? 'http://127.0.0.1:8788'
  }));

export const parseWebEnv = (
  input: Partial<Record<'CONTROL_BASE_URL', string | undefined>>
) =>
  webEnvSchema.parse({
    CONTROL_BASE_URL: input.CONTROL_BASE_URL
  });
