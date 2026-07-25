import { describe, expect, test } from 'bun:test';
import {
  containsMutableContainerTag,
  extractWorkflowActionReferences,
  hasExactPermissions,
  isImmutableActionReference,
  parseWorkflowYaml,
  workflowJobPermissions
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

  test('requires the exact least-privilege reusable-workflow permission map', () => {
    const expected = {
      contents: 'read',
      packages: 'write'
    } as const;

    expect(hasExactPermissions({
      contents: 'read',
      packages: 'write'
    }, expected)).toBe(true);
    expect(hasExactPermissions('read-all', expected)).toBe(false);
    expect(hasExactPermissions('write-all', expected)).toBe(false);
    expect(hasExactPermissions(undefined, expected)).toBe(false);
    expect(hasExactPermissions({
      contents: 'read'
    }, expected)).toBe(false);
    expect(hasExactPermissions({
      contents: 'read',
      packages: 'write',
      'id-token': 'write'
    }, expected)).toBe(false);
  });

  test('parses workflow job permissions and rejects malformed documents', () => {
    const parsed = parseWorkflowYaml(`
jobs:
  ci:
    permissions:
      contents: read
      packages: write
  missing:
    runs-on: ubuntu-latest
`);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(workflowJobPermissions(parsed.document, 'ci')).toEqual({
        contents: 'read',
        packages: 'write'
      });
      expect(workflowJobPermissions(parsed.document, 'missing')).toBeUndefined();
    }

    expect(parseWorkflowYaml('jobs:\n  ci: [')).toEqual({
      ok: false,
      reason: 'invalid_yaml'
    });
    expect(parseWorkflowYaml('- jobs')).toEqual({
      ok: false,
      reason: 'invalid_mapping'
    });
  });
});
