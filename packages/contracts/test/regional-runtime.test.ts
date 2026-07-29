import { describe, expect, test } from 'bun:test';
import {
  regionalExecutionPayloadMaxBytes,
  regionalExecutionRequestSchema,
  regionalExecutionResultSchema,
  regionalRuntimeCapabilitiesSchema
} from '../src/index';

const validRequest = {
  idempotencyKey: 'release_123:tokyo',
  runnerType: 'network_probe',
  targets: [{
    targetId: 'homepage',
    url: 'https://example.com/',
    request: {
      method: 'POST',
      headers: [{ name: 'content-type', value: 'application/json' }],
      body: {
        mode: 'text',
        contentType: 'application/json',
        value: '{"probe":true}'
      }
    }
  }],
  deadlineMs: 60_000,
  maxAttempts: 3,
  timestamp: '2026-07-29T00:00:00.000Z',
  signature: 'a'.repeat(64),
  keyVersion: 'current'
};

describe('regional runtime v1 contracts', () => {
  test('accepts a bounded signed network-probe request', () => {
    expect(regionalExecutionRequestSchema.parse(validRequest)).toMatchObject({
      runnerType: 'network_probe',
      deadlineMs: 60_000
    });
  });

  test('rejects browser jobs and malformed signatures from the network-only v1 surface', () => {
    expect(() => regionalExecutionRequestSchema.parse({
      ...validRequest,
      runnerType: 'browser_audit'
    })).toThrow();
    expect(() => regionalExecutionRequestSchema.parse({
      ...validRequest,
      signature: 'not-hex'
    })).toThrow();
    expect(() => regionalExecutionRequestSchema.parse({
      ...validRequest,
      targets: [validRequest.targets[0], validRequest.targets[0]]
    })).toThrow('target ids must be unique');
    const { maxAttempts: _maxAttempts, ...withoutMaxAttempts } = validRequest;
    expect(() => regionalExecutionRequestSchema.parse(withoutMaxAttempts)).toThrow();
    expect(() => regionalExecutionRequestSchema.parse({
      ...validRequest,
      targets: [{
        ...validRequest.targets[0],
        request: {}
      }]
    })).toThrow();
  });

  test('rejects request headers without a normalized name before queue admission', () => {
    for (const name of ['  ', 'X Bad', 'X:Bad']) {
      expect(regionalExecutionRequestSchema.safeParse({
        ...validRequest,
        targets: [{
          ...validRequest.targets[0],
          request: {
            method: 'GET',
            headers: [{ name, value: 'ignored' }],
            body: null
          }
        }]
      }).success).toBe(false);
    }
  });

  test('rejects unsafe regional header values before queue admission', () => {
    for (const value of ['ok\rbad', 'ok\nbad', 'ok\0bad', 'non-ascii-\u00e9']) {
      expect(regionalExecutionRequestSchema.safeParse({
        ...validRequest,
        targets: [{
          ...validRequest.targets[0],
          request: {
            method: 'GET',
            headers: [{ name: 'x-test', value }],
            body: null
          }
        }]
      }).success).toBe(false);
    }

    expect(regionalExecutionRequestSchema.safeParse({
      ...validRequest,
      targets: [{
        ...validRequest.targets[0],
        request: {
          method: 'GET',
          headers: [{ name: 'x-test', value: 'visible\tvalue' }],
          body: null
        }
      }]
    }).success).toBe(true);
  });

  test('rejects unsafe regional body content types before queue admission', () => {
    for (const contentType of ['text/plain\rx-bad: yes', 'text/plain\nbad', 'text/plain\0']) {
      expect(regionalExecutionRequestSchema.safeParse({
        ...validRequest,
        targets: [{
          ...validRequest.targets[0],
          request: {
            method: 'POST',
            headers: [],
            body: {
              mode: 'text',
              contentType,
              value: 'body'
            }
          }
        }]
      }).success).toBe(false);
    }
  });

  test('rejects unknown regional target fields before queue admission', () => {
    expect(regionalExecutionRequestSchema.safeParse({
      ...validRequest,
      targets: [{
        ...validRequest.targets[0],
        requestConfig: validRequest.targets[0]?.request
      }]
    }).success).toBe(false);
  });

  test('rejects a contract-valid target count that exceeds the transport payload limit', () => {
    const oversized = {
      ...validRequest,
      targets: Array.from({ length: 20 }, (_, index) => ({
        targetId: `target-${index}`,
        url: `https://example.com/${index}`,
        request: {
          method: 'POST',
          headers: Array.from({ length: 20 }, (__, headerIndex) => ({
            name: `x-payload-${headerIndex}`,
            value: 'x'.repeat(4_000)
          })),
          body: {
            mode: 'text',
            contentType: 'text/plain',
            value: 'x'.repeat(10_000)
          }
        }
      }))
    };

    expect(new TextEncoder().encode(JSON.stringify(oversized)).byteLength)
      .toBeGreaterThan(regionalExecutionPayloadMaxBytes);
    expect(regionalExecutionRequestSchema.safeParse(oversized).success).toBe(false);
  });

  test('reports distinct runtime and runner image provenance', () => {
    expect(regionalRuntimeCapabilitiesSchema.parse({
      protocolVersion: 1,
      regionId: 'tokyo',
      regionLabel: 'Tokyo',
      runnerTypes: ['network_probe'],
      maxBatchSize: 100,
      maxPayloadBytes: regionalExecutionPayloadMaxBytes,
      maxDeadlineMs: 900_000,
      maxAttempts: 20,
      runtime: {
        version: '0.3.0',
        imageDigest: `sha256:${'a'.repeat(64)}`
      },
      runner: {
        id: 'probe-rs',
        implementation: 'rust',
        imageDigest: `sha256:${'b'.repeat(64)}`
      }
    }).runner.id).toBe('probe-rs');
  });

  test('rejects a signed regional result without target evidence', () => {
    expect(regionalExecutionResultSchema.safeParse({
      idempotencyKey: 'release_123:tokyo',
      status: 'succeeded',
      targets: [],
      provenance: {
        regionId: 'tokyo',
        runnerType: 'network_probe',
        runtime: { version: '0.3.0', imageDigest: null },
        runner: { id: 'probe-rs', implementation: 'rust', imageDigest: null }
      },
      acceptedAt: '2026-07-29T00:00:00.000Z',
      completedAt: '2026-07-29T00:01:00.000Z',
      signature: 'a'.repeat(64),
      keyVersion: 'current'
    }).success).toBe(false);
  });
});
