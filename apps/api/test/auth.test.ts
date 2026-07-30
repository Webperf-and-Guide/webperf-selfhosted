import { describe, expect, test } from 'bun:test';
import { authorizeApiRequest, type ApiAuthSecrets } from '../src/auth';

const secrets: ApiAuthSecrets = {
  runtimeMode: 'full',
  adminToken: 'current-admin-token-value',
  adminTokenNext: 'next-admin-token-value',
  internalSecret: 'current-internal-secret-value',
  internalSecretNext: 'next-internal-secret-value',
  regionalRuntimeSecret: 'current-regional-runtime-secret',
  regionalRuntimeSecretNext: 'next-regional-runtime-secret'
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
    expect(authorizeApiRequest(request('/v1/regional-capabilities'), secrets)).toBeNull();
    expect(authorizeApiRequest(request('/openapi/public.json'), secrets)).toBeNull();
    expect(authorizeApiRequest(request('/openapi/regional-runtime.json'), secrets)).toBeNull();
    expect(authorizeApiRequest(request('/openapi/control.json'), secrets)?.status).toBe(401);
    expect(authorizeApiRequest(request('/v1/health'), secrets)?.status).toBe(401);
    expect(authorizeApiRequest(request('/v1/runtime-metrics'), secrets)?.status).toBe(401);
  });

  test('accepts current and next admin tokens on protected API routes', () => {
    expect(authorizeApiRequest(request('/v1/sites', secrets.adminToken), secrets)).toBeNull();
    expect(authorizeApiRequest(request('/rpc/app', secrets.adminTokenNext, 'POST'), secrets)).toBeNull();
    expect(
      authorizeApiRequest(
        new Request('http://api.test/v1/sites', {
          headers: { authorization: `bearer ${secrets.adminToken}` }
        }),
        secrets
      )
    ).toBeNull();
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

  test('isolates regional handoff routes from admin and internal credentials', () => {
    expect(authorizeApiRequest(
      request('/v1/regional-executions', secrets.regionalRuntimeSecret, 'POST'),
      secrets
    )).toBeNull();
    expect(authorizeApiRequest(
      request('/v1/regional-executions/execution-1', secrets.regionalRuntimeSecretNext),
      secrets
    )).toBeNull();
    expect(authorizeApiRequest(
      request('/v1/regional-executions', secrets.adminToken, 'POST'),
      secrets
    )?.status).toBe(401);
    expect(authorizeApiRequest(
      request('/v1/regional-executions/execution-1', secrets.internalSecret),
      secrets
    )?.status).toBe(401);
  });

  test('uses only mode-specific credentials for the shared metrics surface', () => {
    expect(authorizeApiRequest(
      request('/v1/runtime-metrics', secrets.adminToken),
      secrets
    )).toBeNull();
    expect(authorizeApiRequest(
      request('/v1/runtime-metrics', secrets.regionalRuntimeSecret),
      secrets
    )?.status).toBe(401);
    const regionalSecrets: ApiAuthSecrets = {
      ...secrets,
      runtimeMode: 'regional-runtime'
    };
    expect(authorizeApiRequest(
      request('/v1/runtime-metrics', secrets.regionalRuntimeSecret),
      regionalSecrets
    )).toBeNull();
    expect(authorizeApiRequest(
      request('/v1/runtime-metrics', secrets.adminToken),
      regionalSecrets
    )?.status).toBe(401);
    expect(authorizeApiRequest(
      request('/v1/runtime-metrics', secrets.internalSecret),
      secrets
    )?.status).toBe(401);
  });
});
