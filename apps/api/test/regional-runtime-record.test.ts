import { describe, expect, test } from 'bun:test';
import type { RegionalExecutionRequest } from '@webperf/contracts';
import { regionalExecutionRecordSchema } from '../src/regional-runtime-record';

const request = {
  idempotencyKey: 'release_123:tokyo',
  runnerType: 'network_probe',
  targets: [{
    targetId: 'homepage',
    url: 'https://example.com/'
  }],
  deadlineMs: 60_000,
  maxAttempts: 3,
  timestamp: '2026-07-29T00:00:00.000Z',
  signature: 'a'.repeat(64),
  keyVersion: 'current'
} satisfies RegionalExecutionRequest;

const record = {
  id: request.idempotencyKey,
  requestDigest: 'b'.repeat(64),
  request,
  provenance: {
    regionId: 'tokyo',
    runnerType: 'network_probe',
    runtime: {
      version: '0.3.0-test',
      imageDigest: `sha256:${'a'.repeat(64)}`
    },
    runner: {
      id: 'probe-rs',
      implementation: 'rust',
      imageDigest: `sha256:${'b'.repeat(64)}`
    }
  },
  targetLinks: [{
    targetId: 'homepage',
    jobId: 'job-homepage',
    executionJobId: 'exec-homepage'
  }],
  acceptedAt: '2026-07-29T00:00:00.100Z',
  deadlineAt: '2026-07-29T00:01:00.100Z',
  cancelledAt: null,
  deadlineExceededAt: null,
  createdAt: '2026-07-29T00:00:00.100Z',
  updatedAt: '2026-07-29T00:00:00.100Z'
};

describe('regional execution record', () => {
  test('rejects ambiguous cancellation and deadline terminal states', () => {
    expect(regionalExecutionRecordSchema.safeParse({
      ...record,
      cancelledAt: '2026-07-29T00:00:30.000Z',
      deadlineExceededAt: '2026-07-29T00:01:00.100Z'
    }).success).toBe(false);
  });

  test('reuses bounded safe identifiers for persisted target links', () => {
    expect(regionalExecutionRecordSchema.safeParse(record).success).toBe(true);
    expect(regionalExecutionRecordSchema.safeParse({
      ...record,
      targetLinks: [{
        ...record.targetLinks[0],
        jobId: '../job-homepage'
      }]
    }).success).toBe(false);
  });

  test('rejects invalid persisted lifecycle ordering', () => {
    expect(regionalExecutionRecordSchema.safeParse({
      ...record,
      deadlineAt: record.acceptedAt
    }).success).toBe(false);
    expect(regionalExecutionRecordSchema.safeParse({
      ...record,
      updatedAt: '2026-07-28T23:59:59.999Z'
    }).success).toBe(false);
    expect(regionalExecutionRecordSchema.safeParse({
      ...record,
      cancelledAt: '2026-07-29T00:00:30.000Z'
    }).success).toBe(false);
    expect(regionalExecutionRecordSchema.safeParse({
      ...record,
      cancelledAt: '2026-07-29T00:00:00.100Z'
    }).success).toBe(true);
    expect(regionalExecutionRecordSchema.safeParse({
      ...record,
      deadlineExceededAt: '2026-07-29T00:00:30.000Z',
      updatedAt: '2026-07-29T00:01:00.100Z'
    }).success).toBe(false);
    expect(regionalExecutionRecordSchema.safeParse({
      ...record,
      deadlineExceededAt: record.deadlineAt,
      updatedAt: record.deadlineAt
    }).success).toBe(true);
  });
});
