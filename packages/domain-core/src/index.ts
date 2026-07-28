import type {
  BrowserAuditWorkerRequest,
  CustomRequestConfig,
  ListQuery,
  PageInfo,
  RequestHeader,
  RuntimeLocation,
  RuntimeRegionId,
  SignedProbeMeasurementRequest
} from '@webperf/contracts';
import { listQuerySchema, runtimeRegionIdSchema } from '@webperf/contracts';

/**
 * Resolve the runtime location for one standalone deployment.
 *
 * Phase 1 of issue #14 replaced the 41-city catalog and region selection
 * helpers (`regionCatalog`, `buildRegionAvailabilityList`,
 * `resolveRequestedRegions`, `dedupeRegions`, `defaultRegionSet`) with this
 * single resolver. One self-hosted deployment owns one fixed runtime
 * location; consumers stamp it onto every measurement, Browser Audit, and
 * report as provenance.
 *
 * `regionId` is required. `label` defaults to the region id when omitted.
 */
export const resolveRuntimeLocation = ({
  regionId,
  label
}: {
  regionId: RuntimeRegionId;
  label?: string;
}): RuntimeLocation => {
  const validatedRegionId = runtimeRegionIdSchema.parse(regionId);
  return {
    regionId: validatedRegionId,
    label: label?.trim() || validatedRegionId
  };
};

export const parseListQuery = (input: {
  pageSize?: number | string | null | undefined;
  pageToken?: string | null | undefined;
  filter?: string | null | undefined;
}): ListQuery =>
  listQuerySchema.parse({
    pageSize: input.pageSize ?? undefined,
    pageToken: input.pageToken ?? undefined,
    filter: input.filter ?? undefined
  });

export const parseListQueryFromSearchParams = (searchParams: URLSearchParams): ListQuery =>
  parseListQuery({
    pageSize: searchParams.get('pageSize'),
    pageToken: searchParams.get('pageToken'),
    filter: searchParams.get('filter')
  });

export const applyListQuery = <T>(
  items: T[],
  query: ListQuery | undefined,
  getSearchableText: (item: T) => Iterable<unknown>
): {
  items: T[];
  pageInfo: PageInfo;
} => {
  const parsedQuery = query ?? listQuerySchema.parse({});
  const normalizedFilter = parsedQuery.filter?.trim().toLowerCase() ?? '';
  const filterTokens = normalizedFilter.length > 0 ? normalizedFilter.split(/\s+/).filter(Boolean) : [];

  const filteredItems =
    filterTokens.length === 0
      ? items
      : items.filter((item) => {
          const haystack = [...getSearchableText(item)]
            .filter((value) => value != null)
            .map((value) => String(value).toLowerCase())
            .join(' ');

          return filterTokens.every((token) => haystack.includes(token));
        });

  const startIndex = Number.parseInt(parsedQuery.pageToken ?? '0', 10);
  const offset = Number.isFinite(startIndex) && startIndex >= 0 ? startIndex : 0;
  const pagedItems = filteredItems.slice(offset, offset + parsedQuery.pageSize);
  const nextOffset = offset + pagedItems.length;

  return {
    items: pagedItems,
    pageInfo: {
      pageSize: parsedQuery.pageSize,
      totalCount: filteredItems.length,
      nextPageToken: nextOffset < filteredItems.length ? String(nextOffset) : null,
      filter: normalizedFilter.length > 0 ? normalizedFilter : null
    }
  };
};

const allowedPorts = new Set(['80', '443']);
const forbiddenHostnames = new Set(['localhost']);

export class UrlValidationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_url'
      | 'invalid_scheme'
      | 'embedded_credentials'
      | 'invalid_port'
      | 'private_hostname'
      | 'private_ip'
  ) {
    super(message);
  }
}

export const validateMeasurementUrl = (value: string) => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new UrlValidationError('Target URL is invalid', 'invalid_url');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new UrlValidationError('Only http and https URLs are allowed', 'invalid_scheme');
  }

  if (url.username || url.password) {
    throw new UrlValidationError('Credentials in URLs are not allowed', 'embedded_credentials');
  }

  if (url.port && !allowedPorts.has(url.port)) {
    throw new UrlValidationError('Only ports 80 and 443 are allowed', 'invalid_port');
  }

  const hostname = url.hostname.toLowerCase();

  if (
    forbiddenHostnames.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new UrlValidationError('Private or local hostnames are blocked', 'private_hostname');
  }

  if (isForbiddenIpLiteral(hostname)) {
    throw new UrlValidationError('Private or link-local IPs are blocked', 'private_ip');
  }

  return url;
};

export const defaultCustomRequestConfig = (): CustomRequestConfig => ({
  method: 'GET',
  headers: [],
  body: null
});

const canonicalizeHeaders = (headers: RequestHeader[]) =>
  [...headers]
    .map((header) => ({
      name: header.name.trim().toLowerCase(),
      value: header.value.trim()
    }))
    .filter((header) => header.name.length > 0)
    .sort((left, right) => {
      if (left.name === right.name) {
        return left.value.localeCompare(right.value);
      }

      return left.name.localeCompare(right.name);
    });

const canonicalizeRequestConfig = (request: CustomRequestConfig | undefined) => {
  const normalized = request ?? defaultCustomRequestConfig();

  return {
    method: normalized.method,
    headers: canonicalizeHeaders(normalized.headers ?? []),
    body:
      normalized.body == null
        ? null
        : {
          mode: normalized.body.mode,
          contentType: normalized.body.contentType,
          value: normalized.body.value
        }
  };
};

export type ProbeSignatureRequest = Omit<SignedProbeMeasurementRequest, 'signature'>;

export const toProbeSignaturePayload = (request: ProbeSignatureRequest) =>
  stableStringify({
    jobId: request.jobId,
    targetId: request.targetId,
    region: request.region,
    url: request.url,
    request: canonicalizeRequestConfig(request.request),
    timestamp: request.timestamp
  });

export const createProbeSignature = async (
  sharedSecret: string,
  request: ProbeSignatureRequest
) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(sharedSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(toProbeSignaturePayload(request))
  );
  return [...new Uint8Array(signature)].map((value) => value.toString(16).padStart(2, '0')).join('');
};

const normalizeBrowserAuditHeaders = (headers: BrowserAuditWorkerRequest['customHeaders']) =>
  [...headers]
    .filter((header) => header.name.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name) || left.value.localeCompare(right.value));

const normalizeBrowserAuditCookies = (cookies: BrowserAuditWorkerRequest['cookies']) =>
  [...cookies].sort((left, right) => left.name.localeCompare(right.name) || left.value.localeCompare(right.value));

export type BrowserAuditSignatureRequest = Omit<BrowserAuditWorkerRequest, 'signature'>;

export const toBrowserAuditSignaturePayload = (request: BrowserAuditSignatureRequest) =>
  JSON.stringify({
    executionId: request.executionId,
    targetUrl: request.targetUrl,
    region: request.region,
    policy: request.policy,
    customHeaders: normalizeBrowserAuditHeaders(request.customHeaders),
    cookies: normalizeBrowserAuditCookies(request.cookies),
    artifactUpload:
      request.artifactUpload == null
        ? null
        : {
            baseUrl: request.artifactUpload.baseUrl,
            bearerToken: request.artifactUpload.bearerToken,
            expiresAt: request.artifactUpload.expiresAt,
            maxArtifactBytes: request.artifactUpload.maxArtifactBytes,
            allowedContentTypes: [...request.artifactUpload.allowedContentTypes].sort()
          },
    timestamp: request.timestamp,
    keyVersion: request.keyVersion
  });

export const createBrowserAuditSignature = async (
  sharedSecret: string,
  request: BrowserAuditSignatureRequest
) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(sharedSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(toBrowserAuditSignaturePayload(request))
  );

  return [...new Uint8Array(signature)].map((value) => value.toString(16).padStart(2, '0')).join('');
};

const stableStringify = (value: unknown): string =>
  JSON.stringify(sortJsonValue(value));

const sortJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJsonValue(nested)])
    );
  }

  return value;
};

const isForbiddenIpLiteral = (hostname: string) => isIpv4Private(hostname) || isIpv6Private(hostname);

const isIpv4Private = (hostname: string) => {
  const parts = hostname.split('.');

  if (parts.length !== 4 || parts.some((part) => part.length === 0 || Number.isNaN(Number(part)))) {
    return false;
  }

  const [a, b] = parts.map((part) => Number(part));

  if (a == null || b == null) {
    return false;
  }

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
};

const isIpv6Private = (hostname: string) => {
  if (!hostname.includes(':')) {
    return false;
  }

  const normalized = hostname.toLowerCase();

  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fe90:') ||
    normalized.startsWith('fea0:') ||
    normalized.startsWith('feb0:')
  );
};

// Phase 3 of issue #14: scheduler dispatch loop shared between the
// standalone scheduler app and the embedded scheduler inside the API.
export * from './scheduler-loop';
