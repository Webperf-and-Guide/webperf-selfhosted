import { describe, expect, test } from 'bun:test';
import {
  probeCapabilitiesSchema,
  probeDefaultMaxInflight,
  probeMeasurementResponseSchema,
  probeProtocolVersion,
  probeTransportMaxPayloadBytes,
  signedProbeMeasurementRequestSchema
} from '../src/probe-api';

const digest = `sha256:${'a'.repeat(64)}`;

describe('stateless probe protocol', () => {
  test('publishes the managed-orchestration capability boundary', () => {
    const capabilities = probeCapabilitiesSchema.parse({
      protocolVersion: probeProtocolVersion,
      region: 'tokyo',
      provenance: {
        implementation: 'rust',
        version: '0.3.1',
        imageDigest: digest
      },
      limits: {
        maxInflight: probeDefaultMaxInflight,
        maxPayloadBytes: probeTransportMaxPayloadBytes,
        measurementTimeoutMs: 40_000
      }
    });

    expect(capabilities.limits.maxInflight).toBe(64);
    expect(capabilities.limits.maxPayloadBytes).toBe(2 * 1_024 * 1_024);
  });

  test('requires bounded identifiers and a canonical HMAC signature', () => {
    expect(signedProbeMeasurementRequestSchema.parse({
      jobId: 'job_123',
      targetId: 'job_123:tokyo',
      region: 'tokyo',
      url: 'https://example.com/',
      timestamp: '2026-07-30T00:00:00.000Z',
      signature: '0'.repeat(64),
      keyVersion: 'current'
    }).targetId).toBe('job_123:tokyo');

    expect(signedProbeMeasurementRequestSchema.safeParse({
      jobId: 'job_123',
      targetId: '../tokyo',
      region: 'tokyo',
      url: 'https://example.com/',
      timestamp: '2026-07-30T00:00:00.000Z',
      signature: 'not-a-digest',
      keyVersion: 'current'
    }).success).toBe(false);
  });

  test('accepts provenance while retaining compatibility with older probe responses', () => {
    const measurement = {
      region: 'tokyo',
      url: 'https://example.com/',
      latencyMs: 42,
      measuredAt: '2026-07-30T00:00:00.000Z',
      statusCode: 200,
      success: true,
      probeImpl: 'rust',
      finalUrl: 'https://example.com/',
      redirectCount: 0,
      timings: {
        dnsMs: 0,
        tcpMs: 10,
        tlsMs: 15,
        totalMs: 42,
        ttfbMs: 40,
        bodySampleMs: 2
      },
      tls: null,
      error: null
    };

    expect(probeMeasurementResponseSchema.parse({ measurement })).not.toHaveProperty(
      'provenance'
    );
    expect(probeMeasurementResponseSchema.parse({
      jobId: 'job_123',
      targetId: 'job_123:tokyo',
      provenance: {
        implementation: 'rust',
        version: '0.3.1',
        imageDigest: digest
      },
      measurement
    }).provenance?.imageDigest).toBe(digest);
  });
});
