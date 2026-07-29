import { describe, expect, test } from 'bun:test';
import type {
  RegionalExecutionRequest,
  RegionalExecutionResult
} from '@webperf/contracts';
import {
  createRegionalExecutionRequestDigest,
  createRegionalExecutionSignature,
  createRegionalResultSignature,
  toRegionalExecutionSignaturePayload,
  verifyRegionalExecutionSignature,
  verifyRegionalResultSignature
} from '../src/index';

const unsignedRequest = {
  idempotencyKey: 'release_123:tokyo',
  runnerType: 'network_probe',
  targets: [
    {
      targetId: 'homepage',
      url: 'https://example.com/',
      request: {
        method: 'GET',
        headers: [{ name: 'accept', value: 'text/html' }],
        body: null
      }
    }
  ],
  deadlineMs: 60_000,
  maxAttempts: 3,
  timestamp: '2026-07-29T00:00:00.000Z',
  keyVersion: 'current'
} satisfies Omit<RegionalExecutionRequest, 'signature'>;

const unsignedResult = {
  idempotencyKey: unsignedRequest.idempotencyKey,
  status: 'succeeded',
  targets: [
    {
      targetId: 'homepage',
      status: 'succeeded',
      region: 'tokyo',
      latencyMs: 42,
      statusCode: 200,
      success: true,
      errorCode: null,
      errorMessage: null,
      startedAt: '2026-07-29T00:00:01.000Z',
      finishedAt: '2026-07-29T00:00:01.042Z'
    }
  ],
  provenance: {
    regionId: 'tokyo',
    runnerType: 'network_probe',
    runtime: {
      version: '0.3.0',
      imageDigest: `sha256:${'a'.repeat(64)}`
    },
    runner: {
      id: 'probe-rs',
      implementation: 'rust',
      imageDigest: `sha256:${'b'.repeat(64)}`
    }
  },
  acceptedAt: '2026-07-29T00:00:00.100Z',
  completedAt: '2026-07-29T00:00:01.042Z',
  keyVersion: 'current'
} satisfies Omit<RegionalExecutionResult, 'signature'>;

describe('regional runtime signatures', () => {
  test('uses a stable canonical request payload and verifies HMAC signatures', async () => {
    expect(toRegionalExecutionSignaturePayload(unsignedRequest)).toBe(
      '{"deadlineMs":60000,"idempotencyKey":"release_123:tokyo","keyVersion":"current","maxAttempts":3,"runnerType":"network_probe","targets":[{"request":{"body":null,"headers":[{"name":"accept","value":"text/html"}],"method":"GET"},"targetId":"homepage","url":"https://example.com/"}],"timestamp":"2026-07-29T00:00:00.000Z"}'
    );

    const signature = await createRegionalExecutionSignature(
      'regional-runtime-test-secret',
      unsignedRequest
    );

    expect(signature).toMatch(/^[a-f0-9]{64}$/);
    expect(await verifyRegionalExecutionSignature(
      'regional-runtime-test-secret',
      unsignedRequest,
      signature
    )).toBe(true);
    expect(await verifyRegionalExecutionSignature(
      'wrong-regional-runtime-secret',
      unsignedRequest,
      signature
    )).toBe(false);
    expect(await verifyRegionalExecutionSignature(
      'regional-runtime-test-secret',
      unsignedRequest,
      'not-a-signature'
    )).toBe(false);
    expect(await verifyRegionalExecutionSignature(
      'regional-runtime-test-secret',
      {
        ...unsignedRequest,
        keyVersion: 'next'
      },
      signature
    )).toBe(false);
  });

  test('keeps idempotency digest stable across transport retries', async () => {
    const retried = {
      ...unsignedRequest,
      timestamp: '2026-07-29T00:04:00.000Z',
      keyVersion: 'next' as const
    };

    expect(await createRegionalExecutionRequestDigest(retried))
      .toBe(await createRegionalExecutionRequestDigest(unsignedRequest));
    const explicitDefaultRequest = {
      ...unsignedRequest,
      targets: unsignedRequest.targets.map((target) => ({
        targetId: target.targetId,
        url: target.url,
        request: {
          method: 'GET' as const,
          headers: [],
          body: null
        }
      }))
    };
    expect(await createRegionalExecutionRequestDigest({
      ...explicitDefaultRequest,
      targets: explicitDefaultRequest.targets.map((target) => ({
        targetId: target.targetId,
        url: target.url
      }))
    })).toBe(await createRegionalExecutionRequestDigest(explicitDefaultRequest));
    expect(await createRegionalExecutionRequestDigest({
      ...unsignedRequest,
      deadlineMs: 120_000
    })).not.toBe(await createRegionalExecutionRequestDigest(unsignedRequest));
  });

  test('signs and verifies the complete result provenance', async () => {
    const signature = await createRegionalResultSignature(
      'regional-runtime-test-secret',
      unsignedResult
    );

    expect(await verifyRegionalResultSignature(
      'regional-runtime-test-secret',
      unsignedResult,
      signature
    )).toBe(true);
    expect(await verifyRegionalResultSignature(
      'regional-runtime-test-secret',
      {
        ...unsignedResult,
        provenance: {
          ...unsignedResult.provenance,
          regionId: 'singapore'
        }
      },
      signature
    )).toBe(false);
    expect(await verifyRegionalResultSignature(
      'regional-runtime-test-secret',
      {
        ...unsignedResult,
        keyVersion: 'next'
      },
      signature
    )).toBe(false);
  });
});
