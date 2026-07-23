import { describe, expect, test } from 'bun:test';
import {
  browserAuditIdentifierMaxLength,
  browserAuditArtifactKindSchema,
  browserAuditArtifactContentTypesForKind,
  browserAuditArtifactLocatorSchema,
  browserAuditScoreKeyLimit,
  browserAuditPolicySchema,
  browserAuditResultSchema,
  browserAuditScoresSchema,
  browserAuditToolchainSchema,
  browserAuditTerminalExecutionStatusValues,
  isBrowserAuditTerminalExecutionStatus,
  standardBrowserAuditArtifactKinds
} from '../src/browser-audit';

const readFixture = async (name: string) =>
  await Bun.file(new URL(`./fixtures/browser-audit/${name}`, import.meta.url)).json();

describe('engine-neutral Browser Audit Protocol', () => {
  test('publishes terminal execution status semantics', () => {
    expect(browserAuditTerminalExecutionStatusValues).toEqual([
      'succeeded',
      'failed',
      'cancelled'
    ]);
    expect(isBrowserAuditTerminalExecutionStatus('succeeded')).toBe(true);
    expect(isBrowserAuditTerminalExecutionStatus('uploading')).toBe(false);
  });

  test('accepts Lighthouse and sitespeed.io normalized result fixtures', async () => {
    const lighthouse = browserAuditResultSchema.parse(
      await readFixture('lighthouse-result.json')
    );
    const sitespeed = browserAuditResultSchema.parse(
      await readFixture('sitespeed-result.json')
    );

    expect(lighthouse.toolchain.engine).toEqual({ id: 'lighthouse', version: '13.1.0' });
    expect(lighthouse.artifacts.map((artifact) => artifact.kind)).toContain('lighthouse-json');
    expect(sitespeed.toolchain.engine).toEqual({ id: 'sitespeed.io', version: '35.0.0' });
    expect(sitespeed.toolchain.runtime.name).toBe('Node.js');
    expect(sitespeed.scores.coach).toBe(0.88);
    expect(sitespeed.extendedMetrics.map((metric) => metric.id)).toEqual([
      'request-count',
      'transfer-size-bytes'
    ]);
    expect(sitespeed.artifacts.map((artifact) => artifact.kind)).toContain(
      'sitespeed-summary'
    );
  });

  test('publishes a versioned standard artifact registry while accepting extensions', () => {
    expect(standardBrowserAuditArtifactKinds).toEqual([
      'lighthouse-json',
      'lighthouse-html',
      'screenshot',
      'trace',
      'har',
      'filmstrip',
      'video',
      'waterfall',
      'log'
    ]);
    expect(browserAuditArtifactKindSchema.parse('sitespeed-summary')).toBe(
      'sitespeed-summary'
    );
    expect(browserAuditArtifactKindSchema.parse('json')).toBe('lighthouse-json');
    expect(browserAuditArtifactContentTypesForKind('lighthouse-json')).toEqual([
      'application/json'
    ]);
    expect(browserAuditArtifactContentTypesForKind('sitespeed-summary')).toContain(
      'text/html'
    );
    expect(browserAuditArtifactContentTypesForKind('constructor')).toContain(
      'application/json'
    );
    expect(() => browserAuditArtifactKindSchema.parse('../report')).toThrow();
    expect(browserAuditArtifactKindSchema.safeParse(
      `a${'b'.repeat(browserAuditIdentifierMaxLength - 1)}`
    ).success).toBe(true);
    expect(browserAuditArtifactKindSchema.safeParse(
      `a${'b'.repeat(browserAuditIdentifierMaxLength)}`
    ).success).toBe(false);
    expect(() => browserAuditScoresSchema.parse({ 'not-valid': 0.5 })).toThrow(
      'lowercase-start'
    );
    expect(() => browserAuditScoresSchema.parse({ [`a${'b'.repeat(120)}`]: 0.5 })).toThrow(
      '120 characters'
    );
    expect(() => browserAuditScoresSchema.parse(Object.fromEntries(
      Array.from({ length: browserAuditScoreKeyLimit + 1 }, (_, index) => [`score${index}`, 0.5])
    ))).toThrow('50 keys');
  });

  test('keeps portable navigation, snapshot, and timespan flows', () => {
    const policy = browserAuditPolicySchema.parse({
      preset: 'desktop',
      flow: {
        steps: [
          { type: 'navigate', label: 'Landing' },
          { type: 'snapshot', label: 'Ready state' },
          { type: 'timespanStart', label: 'Search interaction' },
          { type: 'click', selector: '[data-search]' },
          { type: 'timespanEnd', label: 'Search complete' }
        ]
      }
    });

    expect(policy.preset).toBe('desktop');
    expect(policy.flow.steps.map((step) => step.type)).toEqual([
      'navigate',
      'snapshot',
      'timespanStart',
      'click',
      'timespanEnd'
    ]);
  });

  test('normalizes legacy Lighthouse-shaped persisted results on read', () => {
    const normalized = browserAuditResultSchema.parse({
      summary: {
        finalUrl: 'https://example.com/',
        statusCode: 200,
        performanceScore: 0.92,
        lcpMs: 1_480,
        cls: 0.02
      },
      checkpoints: [],
      issues: [],
      artifacts: [{
        id: 'legacy_json',
        kind: 'json',
        url: 'https://artifacts.example/legacy.json',
        contentType: 'application/json',
        byteSize: 120,
        createdAt: '2026-07-22T00:00:03.000Z'
      }],
      toolchain: {
        flowDslVersion: 'v1',
        bunVersion: '1.3.13',
        chromeVersion: '136.0.0.0',
        puppeteerVersion: '24.7.1',
        lighthouseVersion: '12.6.0'
      },
      startedAt: '2026-07-22T00:00:01.000Z',
      completedAt: '2026-07-22T00:00:03.000Z'
    });

    expect(normalized.protocolVersion).toBe('v1');
    expect(normalized.scores.performance).toBe(0.92);
    expect(normalized.coreMetrics.lcpMs).toBe(1_480);
    expect(normalized.checkpoints[0]).toMatchObject({
      finalUrl: 'https://example.com/',
      statusCode: 200,
      scores: { performance: 0.92 }
    });
    expect(normalized.toolchain).toMatchObject({
      engine: { id: 'lighthouse', version: '12.6.0' },
      browser: { name: 'Chrome', version: '136.0.0.0' },
      runtime: { name: 'Bun', version: '1.3.13' }
    });
    expect(normalized.artifacts[0]).toMatchObject({
      registryVersion: 'v1',
      kind: 'lighthouse-json'
    });
    expect(normalized).not.toHaveProperty('summary');
  });

  test('sanitizes malformed legacy summary fields without rejecting the record', () => {
    const normalized = browserAuditResultSchema.parse({
      summary: {
        finalUrl: 'not a URL',
        statusCode: 999,
        performanceScore: 92,
        lcpMs: -1,
        cls: Number.POSITIVE_INFINITY
      },
      checkpoints: [],
      issues: [],
      artifacts: [],
      toolchain: {
        bunVersion: '1.3.13',
        chromeVersion: '136.0.0.0',
        puppeteerVersion: '24.7.1',
        lighthouseVersion: '12.6.0'
      },
      startedAt: '2026-07-22T00:00:01.000Z',
      completedAt: '2026-07-22T00:00:03.000Z'
    });

    expect(normalized.coreMetrics).toMatchObject({ lcpMs: null, cls: null });
    expect(normalized.scores.performance).toBeNull();
    expect(normalized.checkpoints[0]).toMatchObject({
      finalUrl: null,
      statusCode: null
    });
  });

  test('normalizes partial legacy Lighthouse toolchain versions', () => {
    const normalized = browserAuditResultSchema.parse({
      coreMetrics: { lcpMs: null, cls: null },
      scores: { performance: null },
      extendedMetrics: [],
      checkpoints: [],
      issues: [],
      artifacts: [],
      toolchain: {
        flowDslVersion: 'v1',
        lighthouseVersion: '12.6.0'
      },
      startedAt: '2026-07-22T00:00:01.000Z',
      completedAt: '2026-07-22T00:00:03.000Z'
    });

    expect(normalized.toolchain).toEqual({
      engine: { id: 'lighthouse', version: '12.6.0' },
      browser: { name: 'Chrome', version: 'unknown' },
      runtime: { name: 'Bun', version: 'unknown' },
      components: [{ name: 'puppeteer-core', version: 'unknown' }]
    });
  });

  test('does not infer a Lighthouse toolchain from only a flow DSL version', () => {
    expect(browserAuditToolchainSchema.safeParse({
      flowDslVersion: 'v1'
    }).success).toBe(false);
  });

  test('aligns artifact locator identifiers with storage segments', () => {
    expect(browserAuditArtifactLocatorSchema.safeParse({
      auditId: 'audit_safe-1',
      artifactId: 'artifact_safe-1'
    }).success).toBe(true);
    expect(browserAuditArtifactLocatorSchema.safeParse({
      auditId: '../audit',
      artifactId: 'artifact/escape'
    }).success).toBe(false);
    expect(browserAuditArtifactLocatorSchema.safeParse({
      auditId: `a${'b'.repeat(159)}`,
      artifactId: `a${'b'.repeat(160)}`
    }).success).toBe(false);
  });
});
