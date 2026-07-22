import { z } from 'zod';
import { emptyStringToUndefined } from './shared';

export const selfhostConsoleEnvSchema = z.object({
  CONTROL_BASE_URL: emptyStringToUndefined(z.string().url()).default('http://127.0.0.1:8788'),
  SELFHOST_ADMIN_TOKEN: z.string().trim().min(16)
});

export const parseSelfhostConsoleVars = (
  input: Partial<Record<keyof z.infer<typeof selfhostConsoleEnvSchema>, string | undefined>>
) =>
  selfhostConsoleEnvSchema.parse({
    CONTROL_BASE_URL: input.CONTROL_BASE_URL,
    SELFHOST_ADMIN_TOKEN: input.SELFHOST_ADMIN_TOKEN
  });
