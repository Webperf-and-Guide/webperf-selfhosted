import { describe, expect, test } from 'bun:test';
import { renderSelfhostEnvironment } from './selfhost-init';

const completeTemplate = `SELFHOST_ADMIN_TOKEN=replace
SELFHOST_ADMIN_TOKEN_NEXT=replace
SELFHOST_INTERNAL_SECRET=replace
SELFHOST_INTERNAL_SECRET_NEXT=replace
PROBE_SHARED_SECRET=replace
PROBE_SHARED_SECRET_NEXT=replace
BROWSER_AUDIT_SHARED_SECRET=replace
BROWSER_AUDIT_SHARED_SECRET_NEXT=replace
UNCHANGED=value`;

describe('self-host environment initialization', () => {
  test('fills every current secret, clears rotation slots, and preserves other values', () => {
    let sequence = 0;
    const rendered = renderSelfhostEnvironment(completeTemplate, () => `generated-${++sequence}`);

    expect(rendered).toContain('SELFHOST_ADMIN_TOKEN=generated-1');
    expect(rendered).toContain('BROWSER_AUDIT_SHARED_SECRET=generated-4');
    expect(rendered).toContain('SELFHOST_INTERNAL_SECRET_NEXT=');
    expect(rendered).toContain('UNCHANGED=value');
    expect(rendered).not.toContain('=replace');
  });

  test('rejects template drift before writing an incomplete environment', () => {
    expect(() => renderSelfhostEnvironment(
      completeTemplate.replace('PROBE_SHARED_SECRET_NEXT=replace\n', '')
    )).toThrow('PROBE_SHARED_SECRET_NEXT');
  });
});
