import { describe, expect, test } from 'bun:test';
import { createDefaultLeaseOwner } from './identity';

describe('executor identity', () => {
  test('bounds generated lease owners independently of hostname length', () => {
    const leaseOwner = createDefaultLeaseOwner({
      host: 'pod-'.repeat(100),
      processId: 12345,
      nonce: 'instance-1234'
    });

    expect(leaseOwner.length).toBeLessThanOrEqual(160);
    expect(leaseOwner).toMatch(/^[A-Za-z0-9._:-]+$/);
  });
});
