import { describe, expect, test } from 'bun:test';
import type { JsonValue } from '../src/execution';
import {
  enqueueExecutionJobSchema,
  executionJobSchema,
  executionPayloadMaxDepth
} from '../src/execution';

const nestedPayload = (depth: number): JsonValue => {
  let value: JsonValue = 'leaf';

  for (let index = 0; index < depth; index += 1) {
    value = { child: value };
  }

  return value;
};

const baseExecutionJob = {
  id: 'exec_contract',
  kind: 'network_probe' as const,
  resourceId: 'job_contract',
  status: 'queued' as const,
  leaseOwner: null,
  leaseExpiresAt: null,
  attemptCount: 0,
  maxAttempts: 3,
  availableAt: '2026-07-22T00:00:00.000Z',
  payload: { jobId: 'job_contract' },
  error: null,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  completedAt: null
};

describe('execution job contracts', () => {
  test('bounds recursive payload depth', () => {
    expect(
      enqueueExecutionJobSchema.safeParse({
        id: 'exec_depth_ok',
        kind: 'network_probe',
        resourceId: 'job_depth_ok',
        payload: nestedPayload(executionPayloadMaxDepth)
      }).success
    ).toBe(true);
    expect(
      enqueueExecutionJobSchema.safeParse({
        id: 'exec_depth_rejected',
        kind: 'network_probe',
        resourceId: 'job_depth_rejected',
        payload: nestedPayload(executionPayloadMaxDepth + 1)
      }).success
    ).toBe(false);
  });

  test('enforces retry and lease state invariants', () => {
    expect(
      executionJobSchema.safeParse({
        ...baseExecutionJob,
        attemptCount: 4
      }).success
    ).toBe(false);
    expect(
      executionJobSchema.safeParse({
        ...baseExecutionJob,
        status: 'running',
        attemptCount: 1
      }).success
    ).toBe(false);
    expect(
      executionJobSchema.safeParse({
        ...baseExecutionJob,
        status: 'succeeded',
        completedAt: '2026-07-22T00:01:00.000Z'
      }).success
    ).toBe(true);
  });
});
