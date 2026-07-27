import { z } from 'zod';
import {
  defaultRegionIdsJson,
  defaultSelfhostProbeBaseUrl,
  defaultSelfhostProbeBaseUrlsJson,
  defaultSelfhostRegionCodesJson,
  defaultSelfhostRegionId,
  emptyStringToUndefined
} from './shared';
import { runtimeRegionIdSchema, runtimeRegionLabelSchema } from '@webperf/contracts';

export const defaultSelfhostMaxArtifactBytes = 25_000_000;
export const maximumSelfhostMaxArtifactBytes = 250_000_000;

const normalizedBoolean = (defaultValue: 'true' | 'false') => z.preprocess(
  (value) => typeof value === 'string'
    ? value.trim().toLowerCase()
    : value ?? defaultValue,
  z.enum(['true', 'false']).transform((value) => value === 'true')
);

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
    (value) => value ?? String(defaultSelfhostMaxArtifactBytes),
    z.coerce.number().int().positive().max(maximumSelfhostMaxArtifactBytes)
  ),
  SELFHOST_ARTIFACT_UPLOAD_TTL_SECONDS: z.preprocess(
    (value) => value ?? '900',
    z.coerce.number().int().min(60).max(3_600)
  ),
  SELFHOST_RETENTION_DAYS: z.preprocess(
    (value) => value ?? '30',
    z.coerce.number().int().positive()
  ),
  SELFHOST_MIGRATION_BACKUP: normalizedBoolean('false'),
  SELFHOST_ADMIN_TOKEN: z.string().trim().min(16),
  SELFHOST_ADMIN_TOKEN_NEXT: emptyStringToUndefined(z.string().trim().min(16)),
  SELFHOST_INTERNAL_SECRET: z.string().trim().min(16),
  SELFHOST_INTERNAL_SECRET_NEXT: emptyStringToUndefined(z.string().trim().min(16)),
  SELFHOST_ACTIVE_REGION_CODES_JSON: z.string().default(defaultSelfhostRegionCodesJson),
  SELFHOST_REGION_IDS_JSON: z.string().default(defaultRegionIdsJson),
  SELFHOST_PROBE_BASE_URLS_JSON: z.string().default(defaultSelfhostProbeBaseUrlsJson),
  // Issue #14 Phase 1 single-region runtime identity and probe origin.
  // Added in parallel with the legacy JSON map above; PR2 of Phase 1 removes
  // the legacy map and makes this the only configuration path.
  SELFHOST_REGION_ID: runtimeRegionIdSchema.default(defaultSelfhostRegionId),
  SELFHOST_REGION_LABEL: emptyStringToUndefined(runtimeRegionLabelSchema),
  SELFHOST_PROBE_BASE_URL: z.string().url().default(defaultSelfhostProbeBaseUrl),
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

  // SELFHOST_PROBE_BASE_URL must be a credential-free HTTP(S) origin. The
  // executor appends the signed /measure path itself, matching the existing
  // contract for the legacy SELFHOST_PROBE_BASE_URLS_JSON entries.
  // Zod's `.url()` regex and the WHATWG URL constructor are not perfectly
  // aligned, so a value can pass the schema and still throw here; guard it
  // the same way the executor parser does to keep the failure a clean
  // ZodIssue instead of an uncaught exception during parse.
  let probeBaseUrl: URL | null = null;
  try {
    probeBaseUrl = new URL(config.SELFHOST_PROBE_BASE_URL);
  } catch {
    context.addIssue({
      code: 'custom',
      message: 'Probe base URL is invalid',
      path: ['SELFHOST_PROBE_BASE_URL']
    });
  }
  if (
    probeBaseUrl
    && (
      !['http:', 'https:'].includes(probeBaseUrl.protocol)
      || probeBaseUrl.username
      || probeBaseUrl.password
      || probeBaseUrl.pathname !== '/'
      || probeBaseUrl.search
      || probeBaseUrl.hash
    )
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Probe base URL must be a credential-free HTTP(S) origin without path, query, or fragment',
      path: ['SELFHOST_PROBE_BASE_URL']
    });
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
    SELFHOST_REGION_ID: input.SELFHOST_REGION_ID,
    SELFHOST_REGION_LABEL: input.SELFHOST_REGION_LABEL,
    SELFHOST_PROBE_BASE_URL: input.SELFHOST_PROBE_BASE_URL,
    SELFHOST_BROWSER_AUDIT_BASE_URL: input.SELFHOST_BROWSER_AUDIT_BASE_URL,
    SELFHOST_MAX_TARGET_ATTEMPTS: input.SELFHOST_MAX_TARGET_ATTEMPTS
  });
