import { createHash, timingSafeEqual } from 'node:crypto';

export type ApiAuthSecrets = {
  adminToken?: string;
  adminTokenNext?: string;
  internalSecret: string;
  internalSecretNext?: string;
  regionalRuntimeSecret?: string;
  regionalRuntimeSecretNext?: string;
};

const publicGetPaths = new Set([
  '/health',
  '/v1/capabilities',
  '/v1/regional-capabilities',
  '/openapi/public.json',
  '/openapi/regional-runtime.json'
]);

export const authorizeApiRequest = (request: Request, secrets: ApiAuthSecrets): Response | null => {
  const url = new URL(request.url);

  if (request.method === 'GET' && publicGetPaths.has(url.pathname)) {
    return null;
  }

  const expectedTokens = resolveExpectedTokens(url.pathname, secrets);

  if (matchesBearerToken(request.headers.get('authorization'), expectedTokens)) {
    return null;
  }

  return Response.json(
    {
      error: 'Unauthorized'
    },
    {
      status: 401,
      headers: {
        'cache-control': 'no-store',
        'www-authenticate': 'Bearer realm="webperf-selfhost"'
      }
    }
  );
};

const resolveExpectedTokens = (
  pathname: string,
  secrets: ApiAuthSecrets
): Array<string | undefined> => {
  if (isInternalPath(pathname)) {
    return [secrets.internalSecret, secrets.internalSecretNext];
  }
  if (isRegionalExecutionPath(pathname)) {
    return [secrets.regionalRuntimeSecret, secrets.regionalRuntimeSecretNext];
  }
  return [secrets.adminToken, secrets.adminTokenNext];
};

// Scheduler dispatch predates the /internal namespace and remains a compatibility
// route. Any new service-to-service endpoint must use /internal instead.
const isInternalPath = (pathname: string) =>
  pathname === '/v1/scheduler/dispatch' || pathname.startsWith('/internal/');

const isRegionalExecutionPath = (pathname: string) =>
  pathname === '/v1/regional-executions'
  || pathname.startsWith('/v1/regional-executions/');

const matchesBearerToken = (
  authorization: string | null,
  candidates: Array<string | undefined>
) => {
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);

  if (!match?.[1]) {
    return false;
  }

  const suppliedToken = match[1];
  let matched = false;

  for (const candidate of candidates) {
    matched = constantTimeEqual(suppliedToken, candidate ?? '') || matched;
  }

  return matched;
};

// Hashing normalizes token lengths because timingSafeEqual rejects buffers of
// different sizes. A raw length check would make token length observable.
const constantTimeEqual = (left: string, right: string) => {
  const leftDigest = createHash('sha256').update(left, 'utf8').digest();
  const rightDigest = createHash('sha256').update(right, 'utf8').digest();
  return timingSafeEqual(leftDigest, rightDigest);
};
