import { expect, test } from 'bun:test';
import type { SignedProbeMeasurementRequest } from '@webperf/contracts';
import { createProbeSignature, toProbeSignaturePayload } from '../src/index';

test('probe signature payload matches rust canonical ordering', async () => {
  const request: SignedProbeMeasurementRequest = {
    jobId: 'smoke',
    targetId: 'smoke:tokyo',
    region: 'tokyo',
    url: 'https://example.com',
    timestamp: '2026-04-15T00:00:00.000Z',
    signature: 'pending',
    keyVersion: 'current'
  };

  expect(toProbeSignaturePayload(request)).toBe(
    '{"jobId":"smoke","region":"tokyo","request":{"body":null,"headers":[],"method":"GET"},"targetId":"smoke:tokyo","timestamp":"2026-04-15T00:00:00.000Z","url":"https://example.com"}'
  );

  await expect(createProbeSignature('test-probe-signature-secret', request)).resolves.toBe(
    'db0454ef72753b1169b35dc35f6eb219214d4a99372f806269a15a771311c5f5'
  );
});
