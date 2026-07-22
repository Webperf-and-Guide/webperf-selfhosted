import { describe, expect, test } from 'bun:test';
import { authorizeApiRequest, type ApiAuthSecrets } from '../src/auth';

const secrets: ApiAuthSecrets = {
  adminToken: 'current-admin-token-value',
  adminTokenNext: 'next-admin-token-value',
  internalSecret: 'current-internal-secret-value',
  internalSecretNext: 'next-internal-secret-value'
};

const request = (path: string, token?: string, method = 'GET') =>
  new Request(`http://api.test${path}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : undefined
  });

describe('single-organization API authentication', () => {
  test('keeps only the documented discovery endpoints public', () => {
    expect(authorizeApiRequest(request('/health'), secrets)).toBeNull();
    expect(authorizeApiRequest(request('/v1/capabilities'), secrets)).toBeNull();
    expect(authorizeApiRequest(request('/openapi/public.json'), secrets)).toBeNull();
    expect(authorizeApiRequest(request('/openapi/control.json'), secrets)?.status).toBe(401);
    expect(authorizeApiRequest(request('/v1/health'), secrets)?.status).toBe(401);
  });

  test('accepts current and next admin tokens on protected API routes', () => {
    expect(authorizeApiRequest(request('/v1/sites', secrets.adminToken), secrets)).toBeNull();
    expect(authorizeApiRequest(request('/rpc/app', secrets.adminTokenNext, 'POST'), secrets)).toBeNull();
  });

  test('reserves internal routes for current and next service secrets', () => {
    expect(
      authorizeApiRequest(request('/v1/scheduler/dispatch', secrets.internalSecret, 'POST'), secrets)
    ).toBeNull();
    expect(
      authorizeApiRequest(request('/internal/artifacts', secrets.internalSecretNext, 'POST'), secrets)
    ).toBeNull();
    expect(
      authorizeApiRequest(request('/v1/scheduler/dispatch', secrets.adminToken, 'POST'), secrets)?.status
    ).toBe(401);
  });
});
