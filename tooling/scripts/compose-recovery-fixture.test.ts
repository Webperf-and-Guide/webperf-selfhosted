import { describe, expect, test } from 'bun:test';
import { resolveRecoveryJobRegions } from './compose-recovery-fixture';

describe('Compose recovery fixture compatibility', () => {
  test('reads current single-region and published beta multi-region jobs', () => {
    expect(resolveRecoveryJobRegions({ region: 'tokyo' })).toEqual(['tokyo']);
    expect(resolveRecoveryJobRegions({
      selectedRegions: ['tokyo', 'singapore', 'frankfurt', 'new-york']
    })).toEqual(['tokyo', 'singapore', 'frankfurt', 'new-york']);
  });

  test('rejects jobs without a usable current or legacy region field', () => {
    expect(() => resolveRecoveryJobRegions({})).toThrow(
      'job.selectedRegions must be a non-empty string array'
    );
    expect(() => resolveRecoveryJobRegions({ selectedRegions: ['tokyo', ''] })).toThrow(
      'job.selectedRegions must be a non-empty string array'
    );
  });
});
