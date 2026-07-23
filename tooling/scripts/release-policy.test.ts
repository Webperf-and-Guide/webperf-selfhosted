import { describe, expect, test } from 'bun:test';
import {
  containsMutableContainerTag,
  extractWorkflowActionReferences,
  isImmutableActionReference
} from './release-policy';

describe('release workflow policy helpers', () => {
  test('extracts shorthand, expanded, quoted, and reusable workflow actions', () => {
    const references = extractWorkflowActionReferences(`
      - uses: actions/checkout@${'a'.repeat(40)} # pinned
      - name: Setup
        uses: "owner/setup@v1"
    uses: './.github/workflows/ci.yml'
    `);

    expect(references).toEqual([
      `actions/checkout@${'a'.repeat(40)}`,
      'owner/setup@v1',
      './.github/workflows/ci.yml'
    ]);
    expect(isImmutableActionReference(references[0]!)).toBe(true);
    expect(isImmutableActionReference(references[1]!)).toBe(false);
    expect(isImmutableActionReference(references[2]!)).toBe(true);
    expect(isImmutableActionReference(`docker://alpine@sha256:${'b'.repeat(64)}`)).toBe(true);
    expect(isImmutableActionReference('docker://alpine:latest')).toBe(false);
  });

  test('detects mutable image tags from any registry without matching branch names', () => {
    expect(containsMutableContainerTag('image: docker.io/example/webperf:latest')).toBe(true);
    expect(containsMutableContainerTag('image=registry.example.test/team/webperf:main')).toBe(true);
    expect(containsMutableContainerTag('branches: [main]')).toBe(false);
    expect(containsMutableContainerTag('image: registry.example.test/webperf:0.1.0')).toBe(false);
  });
});
