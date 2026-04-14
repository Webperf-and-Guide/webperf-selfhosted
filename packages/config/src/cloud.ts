import { z } from 'zod';
import { defaultRegionCodesJson, defaultRegionIdsJson, emptyStringToUndefined } from './shared';

export const edgeControlVarsSchema = z.object({
  APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),
  BATCH_MODE: z.enum(['ondemand', 'batch', 'always_on']).default('ondemand'),
  PROBE_SHARED_SECRET: emptyStringToUndefined(z.string().min(8)),
  PROBE_SHARED_SECRET_NEXT: emptyStringToUndefined(z.string().min(8)),
  ACTIVE_REGION_CODES_JSON: z.string().default(defaultRegionCodesJson),
  BUNNY_REGION_IDS_JSON: z.string().default(defaultRegionIdsJson),
  BUNNY_SLOT_CONFIG_JSON: z.string().default('[]'),
  BUNNY_API_BASE_URL: z.string().url().default('https://api.bunny.net/mc'),
  BUNNY_PROBE_IMAGE: z.string().min(1).default('ghcr.io/your-org/webperf-probe:sha-placeholder'),
  BUNNY_PROBE_IMAGE_OVERRIDES_JSON: z.string().default('{}'),
  BROWSER_AUDIT_SHARED_SECRET: emptyStringToUndefined(z.string().min(8)),
  BROWSER_AUDIT_SHARED_SECRET_NEXT: emptyStringToUndefined(z.string().min(8)),
  BUNNY_BROWSER_AUDIT_SLOT_CONFIG_JSON: z.string().default('[]'),
  BUNNY_BROWSER_AUDIT_IMAGE: z.string().min(1).default('ghcr.io/your-org/webperf-browser-audit-worker:sha-placeholder'),
  BUNNY_BROWSER_AUDIT_IMAGE_OVERRIDES_JSON: z.string().default('{}'),
  BROWSER_AUDIT_INTERNAL_BASE_URL: z.string().url().default('http://127.0.0.1:8787'),
  BUNNY_ACCESS_KEY: emptyStringToUndefined(z.string().min(1)),
  OPS_SHARED_SECRET: emptyStringToUndefined(z.string().min(8)),
  REQUESTS_PER_DAY: z.preprocess(
    (value) => value ?? '25',
    z.coerce.number().int().positive()
  ),
  MAX_INFLIGHT_PER_IP: z.preprocess(
    (value) => value ?? '1',
    z.coerce.number().int().positive()
  ),
  MAX_TARGET_ATTEMPTS: z.preprocess(
    (value) => value ?? '3',
    z.coerce.number().int().positive()
  ),
  SLOT_GRACE_SECONDS: z.preprocess(
    (value) => value ?? '300',
    z.coerce.number().int().nonnegative()
  ),
  SLOT_LEASE_SECONDS: z.preprocess(
    (value) => value ?? '120',
    z.coerce.number().int().positive()
  ),
  BUNNY_DEPLOY_TIMEOUT_SECONDS: z.preprocess(
    (value) => value ?? '75',
    z.coerce.number().int().positive()
  ),
  TURNSTILE_SECRET_KEY: emptyStringToUndefined(z.string().min(1))
});

export const parseEdgeControlVars = (
  input: Partial<Record<keyof z.infer<typeof edgeControlVarsSchema>, string | number | undefined>>
) =>
  edgeControlVarsSchema.parse({
    APP_ENV: input.APP_ENV,
    BATCH_MODE: input.BATCH_MODE,
    PROBE_SHARED_SECRET: input.PROBE_SHARED_SECRET,
    PROBE_SHARED_SECRET_NEXT: input.PROBE_SHARED_SECRET_NEXT,
    ACTIVE_REGION_CODES_JSON: input.ACTIVE_REGION_CODES_JSON,
    BUNNY_REGION_IDS_JSON: input.BUNNY_REGION_IDS_JSON,
    BUNNY_SLOT_CONFIG_JSON: input.BUNNY_SLOT_CONFIG_JSON,
    BUNNY_API_BASE_URL: input.BUNNY_API_BASE_URL,
    BUNNY_PROBE_IMAGE: input.BUNNY_PROBE_IMAGE,
    BUNNY_PROBE_IMAGE_OVERRIDES_JSON: input.BUNNY_PROBE_IMAGE_OVERRIDES_JSON,
    BROWSER_AUDIT_SHARED_SECRET: input.BROWSER_AUDIT_SHARED_SECRET,
    BROWSER_AUDIT_SHARED_SECRET_NEXT: input.BROWSER_AUDIT_SHARED_SECRET_NEXT,
    BUNNY_BROWSER_AUDIT_SLOT_CONFIG_JSON: input.BUNNY_BROWSER_AUDIT_SLOT_CONFIG_JSON,
    BUNNY_BROWSER_AUDIT_IMAGE: input.BUNNY_BROWSER_AUDIT_IMAGE,
    BUNNY_BROWSER_AUDIT_IMAGE_OVERRIDES_JSON: input.BUNNY_BROWSER_AUDIT_IMAGE_OVERRIDES_JSON,
    BROWSER_AUDIT_INTERNAL_BASE_URL: input.BROWSER_AUDIT_INTERNAL_BASE_URL,
    BUNNY_ACCESS_KEY: input.BUNNY_ACCESS_KEY,
    OPS_SHARED_SECRET: input.OPS_SHARED_SECRET,
    REQUESTS_PER_DAY: input.REQUESTS_PER_DAY,
    MAX_INFLIGHT_PER_IP: input.MAX_INFLIGHT_PER_IP,
    MAX_TARGET_ATTEMPTS: input.MAX_TARGET_ATTEMPTS,
    SLOT_GRACE_SECONDS: input.SLOT_GRACE_SECONDS,
    SLOT_LEASE_SECONDS: input.SLOT_LEASE_SECONDS,
    BUNNY_DEPLOY_TIMEOUT_SECONDS: input.BUNNY_DEPLOY_TIMEOUT_SECONDS,
    TURNSTILE_SECRET_KEY: input.TURNSTILE_SECRET_KEY
  });
