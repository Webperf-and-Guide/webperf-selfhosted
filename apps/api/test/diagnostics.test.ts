import { describe, expect, test } from 'bun:test';
import { describeSafeError } from '../src/diagnostics';

describe('safe API diagnostics', () => {
  test('records bounded categories without reflecting raw exception data', () => {
    const cause = Object.assign(new Error('Bearer raw-sensitive-cause'), {
      code: 'SQLITE_BUSY'
    });
    cause.name = 'Error with raw-sensitive-name';
    const error = new Error('request failed for https://example.com/?token=raw-sensitive', {
      cause
    });

    const diagnostic = describeSafeError(error);

    expect(diagnostic).toEqual({
      errorType: 'Error',
      causeType: 'UnknownError',
      systemCode: 'SQLITE_BUSY'
    });
    expect(JSON.stringify(diagnostic)).not.toContain('raw-sensitive');
  });
});
