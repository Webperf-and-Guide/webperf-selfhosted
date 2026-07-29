import { z } from 'zod';
import { isIP } from 'node:net';
import { defaultSelfhostProbeBaseUrl, emptyStringToUndefined } from './shared';

export const isLoopbackHostname = (hostname: string) => {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (normalized === 'localhost') {
    return true;
  }

  const family = isIP(normalized);
  if (family === 4) {
    return normalized.split('.')[0] === '127';
  }
  if (family === 6) {
    try {
      return new URL(`http://[${normalized}]/`).hostname === '[::1]';
    } catch {
      return false;
    }
  }
  return false;
};

export const selfhostExecutorEnvSchema = z
  .object({
    SELFHOST_EXECUTOR_API_BASE_URL: z.string().url().default('http://127.0.0.1:8788'),
    SELFHOST_INTERNAL_SECRET: z.string().trim().min(16),
    PROBE_SHARED_SECRET: z.string().trim().min(16),
    BROWSER_AUDIT_SHARED_SECRET: emptyStringToUndefined(z.string().trim().min(16)),
    SELFHOST_PROBE_BASE_URL: z.string().url().default(defaultSelfhostProbeBaseUrl),
    SELFHOST_BROWSER_AUDIT_BASE_URL: emptyStringToUndefined(z.string().url()),
    SELFHOST_EXECUTOR_ALLOW_INSECURE_API_HTTP: z.preprocess(
      (value) => value ?? 'false',
      z.enum(['true', 'false']).transform((value) => value === 'true')
    ),
    SELFHOST_EXECUTOR_ALLOW_INSECURE_PROBE_HTTP: z.preprocess(
      (value) => value ?? 'false',
      z.enum(['true', 'false']).transform((value) => value === 'true')
    ),
    SELFHOST_EXECUTOR_ALLOW_INSECURE_BROWSER_AUDIT_HTTP: z.preprocess(
      (value) => value ?? 'false',
      z.enum(['true', 'false']).transform((value) => value === 'true')
    ),
    SELFHOST_EXECUTOR_ALLOW_INSECURE_WEBHOOK_HTTP: z.preprocess(
      (value) => value ?? 'false',
      z.enum(['true', 'false']).transform((value) => value === 'true')
    ),
    SELFHOST_EXECUTOR_ID: emptyStringToUndefined(z.string().trim().min(1).max(120)),
    SELFHOST_EXECUTOR_POLL_INTERVAL_MS: z.preprocess(
      // This controls idle claim cadence only. Active lease renewal is governed
      // independently by SELFHOST_EXECUTOR_HEARTBEAT_INTERVAL_MS below.
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
    if (config.SELFHOST_BROWSER_AUDIT_BASE_URL && !config.BROWSER_AUDIT_SHARED_SECRET) {
      context.addIssue({
        code: 'custom',
        message: 'A configured Browser Audit runner requires its shared secret',
        path: ['BROWSER_AUDIT_SHARED_SECRET']
      });
    }

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

    if (
      apiUrl
      && apiUrl.protocol === 'http:'
      && !isLoopbackHostname(apiUrl.hostname)
      && !config.SELFHOST_EXECUTOR_ALLOW_INSECURE_API_HTTP
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Executor API HTTP requires a loopback origin or explicit insecure opt-in',
        path: ['SELFHOST_EXECUTOR_API_BASE_URL']
      });
    }

    if (config.SELFHOST_BROWSER_AUDIT_BASE_URL) {
      let browserAuditUrl: URL | null = null;

      try {
        browserAuditUrl = new URL(config.SELFHOST_BROWSER_AUDIT_BASE_URL);
      } catch {
        context.addIssue({
          code: 'custom',
          message: 'Browser Audit URL is invalid',
          path: ['SELFHOST_BROWSER_AUDIT_BASE_URL']
        });
      }

      if (browserAuditUrl) {
        const loopbackHostname = isLoopbackHostname(browserAuditUrl.hostname);
        const protocolAllowed = browserAuditUrl.protocol === 'https:'
          || (
            browserAuditUrl.protocol === 'http:'
            && (loopbackHostname || config.SELFHOST_EXECUTOR_ALLOW_INSECURE_BROWSER_AUDIT_HTTP)
          );

        if (
          !protocolAllowed
          || browserAuditUrl.username
          || browserAuditUrl.password
          || browserAuditUrl.pathname !== '/'
          || browserAuditUrl.search
          || browserAuditUrl.hash
        ) {
          context.addIssue({
            code: 'custom',
            message: 'Browser Audit URL must be an allowed credential-free origin',
            path: ['SELFHOST_BROWSER_AUDIT_BASE_URL']
          });
        }
      }
    }

    // SELFHOST_PROBE_BASE_URL must be a credential-free HTTP(S) origin. The
    // executor appends the signed /measure path itself, matching the existing
    // contract for the legacy SELFHOST_PROBE_BASE_URLS_JSON entries. Loopback
    // and insecure-HTTP policy is enforced by the network handler at runtime
    // using SELFHOST_EXECUTOR_ALLOW_INSECURE_PROBE_HTTP, so this check only
    // bounds the URL shape.
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

    if (config.SELFHOST_EXECUTOR_HEARTBEAT_INTERVAL_MS * 3 > config.SELFHOST_EXECUTOR_LEASE_DURATION_MS) {
      context.addIssue({
        code: 'custom',
        message: 'Executor heartbeat interval must be at most one third of the lease duration',
        path: ['SELFHOST_EXECUTOR_HEARTBEAT_INTERVAL_MS']
      });
    }
  });

export const parseSelfhostExecutorVars = (
  input: Partial<
    Record<keyof z.input<typeof selfhostExecutorEnvSchema>, string | number | undefined>
  >
) => selfhostExecutorEnvSchema.parse(input);
