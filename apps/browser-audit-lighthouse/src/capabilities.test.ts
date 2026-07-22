import { describe, expect, test } from 'bun:test';
import type { BrowserAuditToolchain } from '@webperf/contracts';
import { buildCapabilities } from './capabilities';

const lighthouseToolchain = {
  engine: { id: 'lighthouse', version: '13.1.0' },
  browser: { name: 'Chrome', version: '136.0.0.0' },
  runtime: { name: 'Bun', version: '1.3.13' },
  components: [
    { name: 'puppeteer-core', version: '24.7.1' },
    { name: 'webperf-browser-audit-lighthouse', version: '0.1.0' }
  ]
} satisfies BrowserAuditToolchain;

describe('Lighthouse Browser Audit capabilities', () => {
  test('advertises the engine-neutral protocol and implemented artifact kinds', () => {
    const capabilities = buildCapabilities(lighthouseToolchain);

    expect(capabilities.protocolVersion).toBe('v1');
    expect(capabilities.artifactRegistryVersion).toBe('v1');
    expect(capabilities.toolchain).toEqual(lighthouseToolchain);
    expect(capabilities.supportedArtifactKinds).toEqual([
      'lighthouse-json',
      'lighthouse-html',
      'screenshot',
      'trace'
    ]);
    expect(capabilities.supportedCheckpointModes).toEqual([
      'navigation',
      'snapshot',
      'timespan'
    ]);
  });
});
