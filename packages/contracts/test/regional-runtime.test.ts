import { describe, expect, test } from 'bun:test';
import {
  regionalExecutionRequestSchema,
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

  test('reports distinct runtime and runner image provenance', () => {
    expect(regionalRuntimeCapabilitiesSchema.parse({
      protocolVersion: 1,
      regionId: 'tokyo',
      regionLabel: 'Tokyo',
      runnerTypes: ['network_probe'],
      maxBatchSize: 100,
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
});
