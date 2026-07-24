import { describe, expect, test } from 'bun:test';
import { ExecutorApiError } from './client';
import { describeSafeError } from './diagnostics';

describe('safe executor diagnostics', () => {
  test('keeps bounded diagnostic categories without reflecting raw messages', () => {
    const cause = Object.assign(new Error('Bearer raw-sensitive-message'), {
      code: 'ECONNREFUSED'
    });
    cause.name = 'Bearer raw-sensitive-error-type';

    const diagnostic = describeSafeError(
      new ExecutorApiError('request for secret endpoint failed', 503, { cause })
    );

    expect(diagnostic).toEqual({
      errorType: 'ExecutorApiError',
      status: 503,
      causeType: 'UnknownError',
      systemCode: 'ECONNREFUSED'
    });
    expect(JSON.stringify(diagnostic)).not.toContain('raw-sensitive');
    expect(JSON.stringify(diagnostic)).not.toContain('secret endpoint');
  });
});
