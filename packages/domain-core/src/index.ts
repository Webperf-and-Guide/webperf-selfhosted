import type {
  CustomRequestConfig,
  ListQuery,
  PageInfo,
  RegionAvailability,
  RegionCode,
  RequestHeader,
  SignedProbeMeasurementRequest
} from '@webperf/contracts';
import { listQuerySchema } from '@webperf/contracts';

export type RegionContinent =
  | 'North America'
  | 'Europe'
  | 'Asia'
  | 'South America'
  | 'Oceania'
  | 'Africa';

export type RegionRolloutTrack = 'core' | 'catalog';

export type RegionDefinition = {
  code: RegionCode;
  label: string;
  city: string;
  continent: RegionContinent;
  countryCode: string;
  rolloutTrack: RegionRolloutTrack;
  bunnyRegionHint?: string;
};

export const regionCatalog: RegionDefinition[] = [
  { code: 'ashburn', label: 'Ashburn', city: 'Ashburn', continent: 'North America', countryCode: 'US', rolloutTrack: 'catalog' },
  { code: 'atlanta', label: 'Atlanta', city: 'Atlanta', continent: 'North America', countryCode: 'US', rolloutTrack: 'catalog' },
  { code: 'boston', label: 'Boston', city: 'Boston', continent: 'North America', countryCode: 'US', rolloutTrack: 'catalog' },
  { code: 'chicago', label: 'Chicago', city: 'Chicago', continent: 'North America', countryCode: 'US', rolloutTrack: 'catalog' },
  { code: 'dallas', label: 'Dallas', city: 'Dallas', continent: 'North America', countryCode: 'US', rolloutTrack: 'catalog' },
  { code: 'denver', label: 'Denver', city: 'Denver', continent: 'North America', countryCode: 'US', rolloutTrack: 'catalog' },
  { code: 'losangeles', label: 'Los Angeles', city: 'Los Angeles', continent: 'North America', countryCode: 'US', rolloutTrack: 'catalog' },
  { code: 'miami', label: 'Miami', city: 'Miami', continent: 'North America', countryCode: 'US', rolloutTrack: 'catalog' },
  {
    code: 'newyork',
    label: 'New York',
    city: 'New York City',
    continent: 'North America',
    countryCode: 'US',
    rolloutTrack: 'core',
    bunnyRegionHint: 'US'
  },
  { code: 'sanjose', label: 'San Jose', city: 'San Jose', continent: 'North America', countryCode: 'US', rolloutTrack: 'catalog' },
  { code: 'seattle', label: 'Seattle', city: 'Seattle', continent: 'North America', countryCode: 'US', rolloutTrack: 'catalog' },
  { code: 'toronto', label: 'Toronto', city: 'Toronto', continent: 'North America', countryCode: 'CA', rolloutTrack: 'catalog' },
  { code: 'amsterdam', label: 'Amsterdam', city: 'Amsterdam', continent: 'Europe', countryCode: 'NL', rolloutTrack: 'catalog' },
  { code: 'athens', label: 'Athens', city: 'Athens', continent: 'Europe', countryCode: 'GR', rolloutTrack: 'catalog' },
  { code: 'bucharest', label: 'Bucharest', city: 'Bucharest', continent: 'Europe', countryCode: 'RO', rolloutTrack: 'catalog' },
  { code: 'copenhagen', label: 'Copenhagen', city: 'Copenhagen', continent: 'Europe', countryCode: 'DK', rolloutTrack: 'catalog' },
  {
    code: 'frankfurt',
    label: 'Frankfurt',
    city: 'Frankfurt',
    continent: 'Europe',
    countryCode: 'DE',
    rolloutTrack: 'core',
    bunnyRegionHint: 'DE'
  },
  { code: 'london', label: 'London', city: 'London', continent: 'Europe', countryCode: 'GB', rolloutTrack: 'catalog' },
  { code: 'madrid', label: 'Madrid', city: 'Madrid', continent: 'Europe', countryCode: 'ES', rolloutTrack: 'catalog' },
  { code: 'milan', label: 'Milan', city: 'Milan', continent: 'Europe', countryCode: 'IT', rolloutTrack: 'catalog' },
  { code: 'paris', label: 'Paris', city: 'Paris', continent: 'Europe', countryCode: 'FR', rolloutTrack: 'catalog' },
  { code: 'prague', label: 'Prague', city: 'Prague', continent: 'Europe', countryCode: 'CZ', rolloutTrack: 'catalog' },
  { code: 'stockholm', label: 'Stockholm', city: 'Stockholm', continent: 'Europe', countryCode: 'SE', rolloutTrack: 'catalog' },
  { code: 'vienna', label: 'Vienna', city: 'Vienna', continent: 'Europe', countryCode: 'AT', rolloutTrack: 'catalog' },
  { code: 'warsaw', label: 'Warsaw', city: 'Warsaw', continent: 'Europe', countryCode: 'PL', rolloutTrack: 'catalog' },
  { code: 'zagreb', label: 'Zagreb', city: 'Zagreb', continent: 'Europe', countryCode: 'HR', rolloutTrack: 'catalog' },
  { code: 'bangkok', label: 'Bangkok', city: 'Bangkok', continent: 'Asia', countryCode: 'TH', rolloutTrack: 'catalog' },
  { code: 'hongkong', label: 'Hong Kong', city: 'Hong Kong', continent: 'Asia', countryCode: 'HK', rolloutTrack: 'catalog' },
  { code: 'istanbul', label: 'Istanbul', city: 'Istanbul', continent: 'Asia', countryCode: 'TR', rolloutTrack: 'catalog' },
  { code: 'jakarta', label: 'Jakarta', city: 'Jakarta', continent: 'Asia', countryCode: 'ID', rolloutTrack: 'catalog' },
  { code: 'kualalumpur', label: 'Kuala Lumpur', city: 'Kuala Lumpur', continent: 'Asia', countryCode: 'MY', rolloutTrack: 'catalog' },
  { code: 'manila', label: 'Manila', city: 'Manila', continent: 'Asia', countryCode: 'PH', rolloutTrack: 'catalog' },
  {
    code: 'singapore',
    label: 'Singapore',
    city: 'Singapore',
    continent: 'Asia',
    countryCode: 'SG',
    rolloutTrack: 'core',
    bunnyRegionHint: 'SG'
  },
  { code: 'telaviv', label: 'Tel Aviv', city: 'Tel Aviv', continent: 'Asia', countryCode: 'IL', rolloutTrack: 'catalog' },
  {
    code: 'tokyo',
    label: 'Tokyo',
    city: 'Tokyo',
    continent: 'Asia',
    countryCode: 'JP',
    rolloutTrack: 'core',
    bunnyRegionHint: 'JP'
  },
  { code: 'bogota', label: 'Bogota', city: 'Bogota', continent: 'South America', countryCode: 'CO', rolloutTrack: 'catalog' },
  { code: 'mexicocity', label: 'Mexico City', city: 'Mexico City', continent: 'South America', countryCode: 'MX', rolloutTrack: 'catalog' },
  { code: 'saopaulo', label: 'Sao Paulo', city: 'Sao Paulo', continent: 'South America', countryCode: 'BR', rolloutTrack: 'catalog' },
  { code: 'sydney', label: 'Sydney', city: 'Sydney', continent: 'Oceania', countryCode: 'AU', rolloutTrack: 'catalog' },
  { code: 'johannesburg', label: 'Johannesburg', city: 'Johannesburg', continent: 'Africa', countryCode: 'ZA', rolloutTrack: 'catalog' },
  { code: 'lagos', label: 'Lagos', city: 'Lagos', continent: 'Africa', countryCode: 'NG', rolloutTrack: 'catalog' }
];

export const defaultRegions = ['tokyo', 'singapore', 'frankfurt', 'newyork'] as const satisfies readonly RegionCode[];
export const defaultRegionSet = new Set<RegionCode>(defaultRegions);
export const maxSelectableRegions = 4;

export const buildRegionAvailabilityList = ({
  activeRegionCodes,
  regionHints = {}
}: {
  activeRegionCodes: RegionCode[];
  regionHints?: Partial<Record<RegionCode, string>>;
}): RegionAvailability[] => {
  const activeRegions = new Set(activeRegionCodes);

  return regionCatalog.map((region) => {
    const selectable = activeRegions.has(region.code) && Boolean(regionHints[region.code] ?? region.bunnyRegionHint);

    return {
      code: region.code,
      label: region.label,
      city: region.city,
      continent: region.continent,
      selectable,
      defaultSelected: selectable && defaultRegionSet.has(region.code),
      launchStage: region.rolloutTrack === 'core' ? 'core' : 'catalog',
      rolloutTrack: region.rolloutTrack,
      bunnyRegionHint: regionHints[region.code] ?? region.bunnyRegionHint
    } satisfies RegionAvailability;
  });
};

export const resolveRequestedRegions = ({
  requestedRegions,
  availability,
  fallbackRegions = [...defaultRegionSet]
}: {
  requestedRegions?: RegionCode[];
  availability: RegionAvailability[];
  fallbackRegions?: RegionCode[];
}) => {
  const regions = dedupeRegions(
    requestedRegions && requestedRegions.length > 0 ? requestedRegions : fallbackRegions
  );
  const selectable = new Set(availability.filter((region) => region.selectable).map((region) => region.code));

  if (regions.length === 0) {
    throw new Error('At least one region must be selected');
  }

  if (regions.length > maxSelectableRegions) {
    throw new Error(`Select at most ${maxSelectableRegions} regions`);
  }

  for (const region of regions) {
    if (!selectable.has(region)) {
      throw new Error(`Region ${region} is not active yet`);
    }
  }

  return regions;
};

export const dedupeRegions = (regions: RegionCode[]) => {
  const seen = new Set<RegionCode>();
  const output: RegionCode[] = [];

  for (const region of regions) {
    if (!seen.has(region)) {
      seen.add(region);
      output.push(region);
    }
  }

  return output;
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

export const resolveRegionOverride = <T>({
  region,
  defaultValue,
  overrides
}: {
  region: RegionCode;
  defaultValue: T;
  overrides: Partial<Record<RegionCode, T>>;
}) => overrides[region] ?? defaultValue;

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

export const toProbeSignaturePayload = (request: SignedProbeMeasurementRequest) =>
  JSON.stringify({
    jobId: request.jobId,
    targetId: request.targetId,
    region: request.region,
    url: request.url,
    request: canonicalizeRequestConfig(request.request),
    timestamp: request.timestamp
  });

export const createProbeSignature = async (
  sharedSecret: string,
  request: SignedProbeMeasurementRequest
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
