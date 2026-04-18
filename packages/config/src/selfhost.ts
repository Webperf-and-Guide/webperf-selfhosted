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
  SELFHOST_RETENTION_DAYS: z.preprocess(
    (value) => value ?? '30',
    z.coerce.number().int().positive()
  ),
  PROBE_SHARED_SECRET: emptyStringToUndefined(z.string().min(8)).default('dev-shared-secret'),
  PROBE_SHARED_SECRET_NEXT: emptyStringToUndefined(z.string().min(8)),
  BROWSER_AUDIT_SHARED_SECRET: emptyStringToUndefined(z.string().min(8)),
  BROWSER_AUDIT_SHARED_SECRET_NEXT: emptyStringToUndefined(z.string().min(8)),
  SELFHOST_ACTIVE_REGION_CODES_JSON: z.string().default(defaultSelfhostRegionCodesJson),
  SELFHOST_REGION_IDS_JSON: z.string().default(defaultRegionIdsJson),
  SELFHOST_PROBE_BASE_URLS_JSON: z.string().default(defaultSelfhostProbeBaseUrlsJson),
  SELFHOST_BROWSER_AUDIT_BASE_URL: emptyStringToUndefined(z.string().url()).default('http://127.0.0.1:8081'),
  SELFHOST_MAX_TARGET_ATTEMPTS: z.preprocess(
    (value) => value ?? '1',
    z.coerce.number().int().positive()
  )
});

export const parseSelfhostApiVars = (
  input: Partial<Record<keyof z.infer<typeof selfhostApiEnvSchema>, string | number | undefined>>
) =>
  selfhostApiEnvSchema.parse({
    SELFHOST_API_HOST: input.SELFHOST_API_HOST,
    SELFHOST_API_PORT: input.SELFHOST_API_PORT,
    SELFHOST_DATABASE_PATH: input.SELFHOST_DATABASE_PATH,
    SELFHOST_RETENTION_DAYS: input.SELFHOST_RETENTION_DAYS,
    PROBE_SHARED_SECRET: input.PROBE_SHARED_SECRET,
    PROBE_SHARED_SECRET_NEXT: input.PROBE_SHARED_SECRET_NEXT,
    BROWSER_AUDIT_SHARED_SECRET: input.BROWSER_AUDIT_SHARED_SECRET,
    BROWSER_AUDIT_SHARED_SECRET_NEXT: input.BROWSER_AUDIT_SHARED_SECRET_NEXT,
    SELFHOST_ACTIVE_REGION_CODES_JSON: input.SELFHOST_ACTIVE_REGION_CODES_JSON,
    SELFHOST_REGION_IDS_JSON: input.SELFHOST_REGION_IDS_JSON,
    SELFHOST_PROBE_BASE_URLS_JSON: input.SELFHOST_PROBE_BASE_URLS_JSON,
    SELFHOST_BROWSER_AUDIT_BASE_URL: input.SELFHOST_BROWSER_AUDIT_BASE_URL,
    SELFHOST_MAX_TARGET_ATTEMPTS: input.SELFHOST_MAX_TARGET_ATTEMPTS
  });
