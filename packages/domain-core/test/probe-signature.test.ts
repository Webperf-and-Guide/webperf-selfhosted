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

  await expect(createProbeSignature('dev-shared-secret', request)).resolves.toBe(
    'f8ba59af93e360cba2e72ef9fd653e0a1f675b64110b336ac4b14de77e756448'
  );
});
