import { z } from 'zod';
import {
  defaultRegionIdsJson,
  defaultSelfhostProbeBaseUrlsJson,
  defaultSelfhostRegionCodesJson,
  emptyStringToUndefined
} from './shared';

export const selfhostApiEnvSchema = z.object({
  SELFHOST_API_HOST: z.string().min(1).default('0.0.0.0'),
  SELFHOST_API_PORT: z.preprocess(
    (value) => value ?? '8788',
    z.coerce.number().int().positive()
  ),
  SELFHOST_DATABASE_PATH: z.string().min(1).default('./data/webperf.sqlite'),
  SELFHOST_ARTIFACTS_PATH: z.string().trim().min(1).default('./data/artifacts'),
  SELFHOST_ARTIFACT_UPLOAD_BASE_URL: emptyStringToUndefined(z.string().url()),
  SELFHOST_MAX_ARTIFACT_BYTES: z.preprocess(
    (value) => value ?? '25000000',
    z.coerce.number().int().positive().max(250_000_000)
  ),
  SELFHOST_ARTIFACT_UPLOAD_TTL_SECONDS: z.preprocess(
    (value) => value ?? '900',
    z.coerce.number().int().min(60).max(3_600)
  ),
  SELFHOST_RETENTION_DAYS: z.preprocess(
    (value) => value ?? '30',
    z.coerce.number().int().positive()
  ),
  SELFHOST_MIGRATION_BACKUP: z.preprocess(
    (value) => value ?? 'false',
    z.enum(['true', 'false']).transform((value) => value === 'true')
  ),
  SELFHOST_ADMIN_TOKEN: z.string().trim().min(16),
  SELFHOST_ADMIN_TOKEN_NEXT: emptyStringToUndefined(z.string().trim().min(16)),
  SELFHOST_INTERNAL_SECRET: z.string().trim().min(16),
  SELFHOST_INTERNAL_SECRET_NEXT: emptyStringToUndefined(z.string().trim().min(16)),
  SELFHOST_ACTIVE_REGION_CODES_JSON: z.string().default(defaultSelfhostRegionCodesJson),
  SELFHOST_REGION_IDS_JSON: z.string().default(defaultRegionIdsJson),
  SELFHOST_PROBE_BASE_URLS_JSON: z.string().default(defaultSelfhostProbeBaseUrlsJson),
  SELFHOST_BROWSER_AUDIT_BASE_URL: emptyStringToUndefined(z.string().url()),
  SELFHOST_MAX_TARGET_ATTEMPTS: z.preprocess(
    (value) => value ?? '3',
    z.coerce.number().int().positive().max(20)
  )
}).superRefine((config, context) => {
  if (config.SELFHOST_ARTIFACT_UPLOAD_BASE_URL) {
    const url = new URL(config.SELFHOST_ARTIFACT_UPLOAD_BASE_URL);

    if (
      !['http:', 'https:'].includes(url.protocol)
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Artifact upload base URL must be an HTTP(S) origin without path, credentials, query, or fragment',
        path: ['SELFHOST_ARTIFACT_UPLOAD_BASE_URL']
      });
    }
  }
});

export const parseSelfhostApiVars = (
  input: Partial<Record<keyof z.infer<typeof selfhostApiEnvSchema>, string | number | undefined>>
) =>
  selfhostApiEnvSchema.parse({
    SELFHOST_API_HOST: input.SELFHOST_API_HOST,
    SELFHOST_API_PORT: input.SELFHOST_API_PORT,
    SELFHOST_DATABASE_PATH: input.SELFHOST_DATABASE_PATH,
    SELFHOST_ARTIFACTS_PATH: input.SELFHOST_ARTIFACTS_PATH,
    SELFHOST_ARTIFACT_UPLOAD_BASE_URL: input.SELFHOST_ARTIFACT_UPLOAD_BASE_URL,
    SELFHOST_MAX_ARTIFACT_BYTES: input.SELFHOST_MAX_ARTIFACT_BYTES,
    SELFHOST_ARTIFACT_UPLOAD_TTL_SECONDS: input.SELFHOST_ARTIFACT_UPLOAD_TTL_SECONDS,
    SELFHOST_RETENTION_DAYS: input.SELFHOST_RETENTION_DAYS,
    SELFHOST_MIGRATION_BACKUP: input.SELFHOST_MIGRATION_BACKUP,
    SELFHOST_ADMIN_TOKEN: input.SELFHOST_ADMIN_TOKEN,
    SELFHOST_ADMIN_TOKEN_NEXT: input.SELFHOST_ADMIN_TOKEN_NEXT,
    SELFHOST_INTERNAL_SECRET: input.SELFHOST_INTERNAL_SECRET,
    SELFHOST_INTERNAL_SECRET_NEXT: input.SELFHOST_INTERNAL_SECRET_NEXT,
    SELFHOST_ACTIVE_REGION_CODES_JSON: input.SELFHOST_ACTIVE_REGION_CODES_JSON,
    SELFHOST_REGION_IDS_JSON: input.SELFHOST_REGION_IDS_JSON,
    SELFHOST_PROBE_BASE_URLS_JSON: input.SELFHOST_PROBE_BASE_URLS_JSON,
    SELFHOST_BROWSER_AUDIT_BASE_URL: input.SELFHOST_BROWSER_AUDIT_BASE_URL,
    SELFHOST_MAX_TARGET_ATTEMPTS: input.SELFHOST_MAX_TARGET_ATTEMPTS
  });
