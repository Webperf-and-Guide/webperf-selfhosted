import { createHash, timingSafeEqual } from 'node:crypto';

export type ApiAuthSecrets = {
  adminToken: string;
  adminTokenNext?: string;
  internalSecret: string;
  internalSecretNext?: string;
};

const publicGetPaths = new Set(['/health', '/v1/capabilities', '/openapi/public.json']);

export const authorizeApiRequest = (request: Request, secrets: ApiAuthSecrets): Response | null => {
  const url = new URL(request.url);

  if (request.method === 'GET' && publicGetPaths.has(url.pathname)) {
    return null;
  }

  const expectedTokens = isInternalPath(url.pathname)
    ? [secrets.internalSecret, secrets.internalSecretNext]
    : [secrets.adminToken, secrets.adminTokenNext];

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

const isInternalPath = (pathname: string) =>
  pathname === '/v1/scheduler/dispatch' || pathname.startsWith('/internal/');

const matchesBearerToken = (
  authorization: string | null,
  candidates: Array<string | undefined>
) => {
  const match = authorization?.match(/^Bearer ([^\s]+)$/);

  if (!match?.[1]) {
    return false;
  }

  const suppliedToken = match[1];
  let matched = false;

  for (const candidate of candidates) {
    if (candidate !== undefined) {
      matched = constantTimeEqual(suppliedToken, candidate) || matched;
    }
  }

  return matched;
};

const constantTimeEqual = (left: string, right: string) => {
  const leftDigest = createHash('sha256').update(left, 'utf8').digest();
  const rightDigest = createHash('sha256').update(right, 'utf8').digest();
  return timingSafeEqual(leftDigest, rightDigest);
};
