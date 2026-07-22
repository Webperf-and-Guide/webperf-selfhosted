import { z } from 'zod';
import { defaultSelfhostProbeBaseUrlsJson, emptyStringToUndefined } from './shared';

export const selfhostExecutorEnvSchema = z
  .object({
    SELFHOST_EXECUTOR_API_BASE_URL: z.string().url().default('http://127.0.0.1:8788'),
    SELFHOST_INTERNAL_SECRET: z.string().trim().min(16),
    PROBE_SHARED_SECRET: z.string().trim().min(16),
    SELFHOST_PROBE_BASE_URLS_JSON: z.string().default(defaultSelfhostProbeBaseUrlsJson),
    SELFHOST_EXECUTOR_ID: emptyStringToUndefined(z.string().trim().min(1).max(120)),
    SELFHOST_EXECUTOR_POLL_INTERVAL_MS: z.preprocess(
      (value) => value ?? '1000',
      z.coerce.number().int().min(100).max(60_000)
    ),
    SELFHOST_EXECUTOR_LEASE_DURATION_MS: z.preprocess(
      (value) => value ?? '60000',
      z.coerce.number().int().min(10_000).max(3_600_000)
    ),
    SELFHOST_EXECUTOR_HEARTBEAT_INTERVAL_MS: z.preprocess(
      (value) => value ?? '20000',
      z.coerce.number().int().min(1_000).max(600_000)
    ),
    SELFHOST_EXECUTOR_MAX_EXECUTION_MS: z.preprocess(
      (value) => value ?? '900000',
      z.coerce.number().int().min(1_000).max(86_400_000)
    )
  })
  .superRefine((config, context) => {
    let apiUrl: URL | null = null;

    try {
      apiUrl = new URL(config.SELFHOST_EXECUTOR_API_BASE_URL);
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Executor API URL is invalid',
        path: ['SELFHOST_EXECUTOR_API_BASE_URL']
      });
    }

    if (
      apiUrl
      && (
        !['http:', 'https:'].includes(apiUrl.protocol)
        || apiUrl.username
        || apiUrl.password
        || apiUrl.pathname !== '/'
        || apiUrl.search
        || apiUrl.hash
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Executor API URL must be an HTTP(S) origin without path, credentials, query, or fragment',
        path: ['SELFHOST_EXECUTOR_API_BASE_URL']
      });
    }

    if (config.SELFHOST_EXECUTOR_HEARTBEAT_INTERVAL_MS * 2 >= config.SELFHOST_EXECUTOR_LEASE_DURATION_MS) {
      context.addIssue({
        code: 'custom',
        message: 'Executor heartbeat interval must be less than half the lease duration',
        path: ['SELFHOST_EXECUTOR_HEARTBEAT_INTERVAL_MS']
      });
    }
  });

export const parseSelfhostExecutorVars = (
  input: Partial<
    Record<keyof z.input<typeof selfhostExecutorEnvSchema>, string | number | undefined>
  >
) => selfhostExecutorEnvSchema.parse(input);
