import {
  browserAuditArtifactRefSchema,
  browserAuditResultSchema,
  standardBrowserAuditArtifactContentTypes,
  type BrowserAuditArtifactKind,
  type BrowserAuditArtifactRef,
  type BrowserAuditCapabilities,
  type BrowserAuditFlowStep,
  type BrowserAuditStandardArtifactKind,
  type BrowserAuditToolchain,
  type BrowserAuditWorkerRequest
} from '@webperf/contracts';
import puppeteer from 'puppeteer-core';
import type { Browser, Page } from 'puppeteer-core';
import type { BrowserAuditWorkerConfig } from './config';
import { installBrowserNetworkGuard, validateBrowserRequestUrl } from './network-policy';
import { startBrowserNetworkProxy } from './network-proxy';
import {
  redactBrowserAuditBytesInPlace,
  redactBrowserAuditText,
  redactBrowserAuditUrl
} from './redaction';

const presetViewport = {
  mobile: {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true
  },
  desktop: {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false
  }
} as const;
const lighthouseArtifactContentTypes = {
  html: `${requireRegisteredArtifactContentType('lighthouse-html', 'text/html')}; charset=utf-8`,
  json: requireRegisteredArtifactContentType('lighthouse-json', 'application/json'),
  screenshot: requireRegisteredArtifactContentType('screenshot', 'image/png'),
  trace: requireRegisteredArtifactContentType('trace', 'application/json')
};

function requireRegisteredArtifactContentType(
  kind: BrowserAuditStandardArtifactKind,
  expected: string
) {
  const registered = standardBrowserAuditArtifactContentTypes[kind].find(
    (contentType) => contentType === expected
  );

  if (!registered) {
    throw new Error(`Browser Audit artifact registry is missing ${kind} content type ${expected}`);
  }

  return registered;
}

export const runBrowserAudit = async ({
  config,
  input,
  toolchain,
  capabilities
}: {
  config: BrowserAuditWorkerConfig;
  input: BrowserAuditWorkerRequest;
  toolchain: BrowserAuditToolchain;
  capabilities: BrowserAuditCapabilities;
}) => {
  if (!config.chromeExecutablePath) {
    throw new Error('Chrome executable is not configured');
  }

  await validateBrowserRequestUrl(input.targetUrl, { allowlist: config.hostAllowlist });

  for (const step of input.policy.flow.steps) {
    if (step.type === 'navigate' && step.url) {
      await validateBrowserRequestUrl(step.url, { allowlist: config.hostAllowlist });
    }
  }

  const networkProxy = await startBrowserNetworkProxy({
    allowlist: config.hostAllowlist
  });
  let browser: Browser;
  try {
    browser = await launchBrowser(config, networkProxy.url);
  } catch (error) {
    await networkProxy.close().catch(() => undefined);
    throw error;
  }
  let page: Page;
  try {
    page = await browser.newPage();
  } catch (error) {
    await browser.close().catch(() => undefined);
    await networkProxy.close().catch(() => undefined);
    throw error;
  }
  let networkGuard: Awaited<ReturnType<typeof installBrowserNetworkGuard>>;
  try {
    networkGuard = await installBrowserNetworkGuard(page, config.hostAllowlist);
  } catch (error) {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    await networkProxy.close().catch(() => undefined);
    throw error;
  }
  const startedAt = new Date().toISOString();
  const issues: Array<{ code: string; severity: 'info' | 'warning' | 'error'; message: string }> = [];
  const artifacts: BrowserAuditArtifactRef[] = [];
  let traceBuffer: Uint8Array | null = null;
  let responseStatusCode: number | null = null;
  let finalUrl: string | null = null;

  try {
    await page.setViewport(presetViewport[input.policy.preset]);

    const tracingApi = (page as Page & { tracing?: { start: (options?: unknown) => Promise<void>; stop: () => Promise<Uint8Array> } })
      .tracing;

    if (input.policy.artifacts.trace && tracingApi) {
      try {
        await tracingApi.start({ screenshots: false });
      } catch (error) {
        issues.push({
          code: 'trace_start_failed',
          severity: 'warning',
          message: redactBrowserAuditText(error instanceof Error ? error.message : 'Failed to start tracing', input)
        });
      }
    }

    const importedFlow = (await import('lighthouse/core/user-flow.js')) as unknown as {
      UserFlow?: new (page: Page, options?: Record<string, unknown>) => any;
      default?: new (page: Page, options?: Record<string, unknown>) => any;
    };
    const UserFlow = importedFlow.UserFlow ?? importedFlow.default;

    if (typeof UserFlow !== 'function') {
      throw new Error('Lighthouse user-flow API is unavailable');
    }

    const flow = new UserFlow(page, {
      name: input.executionId
    });

    await applySetupState(page, input);

    const deadline = Date.now() + input.policy.timeouts.totalTimeoutMs;
    let navigationSeen = false;

    for (const [index, step] of input.policy.flow.steps.entries()) {
      enforceDeadline(deadline, input.policy.timeouts.totalTimeoutMs);

      if (step.type === 'navigate') {
        const url = step.url ?? input.targetUrl;
        await validateBrowserRequestUrl(url, { allowlist: config.hostAllowlist });

        try {
          await flow.navigate(
            async () => {
              const response = await page.goto(url, {
                waitUntil: 'networkidle0',
                timeout: input.policy.timeouts.stepTimeoutMs
              } as any);
              responseStatusCode = response?.status() ?? responseStatusCode;
            },
            {
              name: step.label ?? `navigate-${index + 1}`
            }
          );
        } catch (error) {
          networkGuard.throwIfBlocked(error);
          throw error;
        }
        networkGuard.throwIfBlocked();
        finalUrl = redactBrowserAuditUrl(page.url(), input);
        navigationSeen = true;
        continue;
      }

      if (!navigationSeen) {
        throw new Error('Flow must navigate before interactive steps');
      }

      await runStep(page, flow, step, input.policy.timeouts.stepTimeoutMs);
      networkGuard.throwIfBlocked();
    }

    if (input.policy.artifacts.screenshot) {
      try {
        const screenshot = (await page.screenshot({
          type: 'png',
          fullPage: true
        })) as Uint8Array;
        artifacts.push(...(await uploadArtifact(
          input,
          'screenshot',
          'screenshot.png',
          lighthouseArtifactContentTypes.screenshot,
          screenshot
        )));
      } catch (error) {
        issues.push({
          code: 'screenshot_failed',
          severity: 'warning',
          message: redactBrowserAuditText(error instanceof Error ? error.message : 'Failed to capture screenshot', input)
        });
      }
    }

    if (input.policy.artifacts.trace && tracingApi) {
      try {
        traceBuffer = (await tracingApi.stop()) ?? null;
      } catch (error) {
        issues.push({
          code: 'trace_stop_failed',
          severity: 'warning',
          message: redactBrowserAuditText(error instanceof Error ? error.message : 'Failed to finish tracing', input)
        });
      }
    }

    const rawFlowResult = (await flow.createFlowResult()) as any;
    networkGuard.throwIfBlocked();
    const reportHtml = typeof flow.generateReport === 'function' ? ((await flow.generateReport()) as string) : null;

    if (input.policy.artifacts.json) {
      artifacts.push(
        ...(await uploadArtifact(
          input,
          'lighthouse-json',
          'flow-result.json',
          lighthouseArtifactContentTypes.json,
          new TextEncoder().encode(redactBrowserAuditText(JSON.stringify(rawFlowResult, null, 2), input))
        ))
      );
    }

    if (input.policy.artifacts.html && reportHtml) {
      artifacts.push(
        ...(await uploadArtifact(
          input,
          'lighthouse-html',
          'report.html',
          lighthouseArtifactContentTypes.html,
          new TextEncoder().encode(redactBrowserAuditText(reportHtml, input))
        ))
      );
    }

    if (traceBuffer && input.policy.artifacts.trace) {
      artifacts.push(
        ...(await uploadArtifact(
          input,
          'trace',
          'trace.json',
          lighthouseArtifactContentTypes.trace,
          redactBrowserAuditBytesInPlace(traceBuffer, input)
        ))
      );
    }

    const completedAt = new Date().toISOString();
    const checkpoints = extractCheckpointResults(rawFlowResult, responseStatusCode, finalUrl, input);
    const primaryCheckpoint =
      checkpoints[0]
      ?? extractNormalizedMetrics(rawFlowResult?.steps?.[0], responseStatusCode, finalUrl, input);
    const result = browserAuditResultSchema.parse({
      coreMetrics: primaryCheckpoint.coreMetrics,
      scores: primaryCheckpoint.scores,
      extendedMetrics: primaryCheckpoint.extendedMetrics,
      checkpoints,
      issues,
      artifacts,
      toolchain,
      startedAt,
      completedAt
    });

    return result;
  } finally {
    try {
      await page.close();
    } catch {}
    try {
      await browser.close();
    } catch {}
    await networkProxy.close().catch(() => undefined);
  }
};

const applySetupState = async (page: Page, input: BrowserAuditWorkerRequest) => {
  if (input.customHeaders.length > 0) {
    await page.setExtraHTTPHeaders(
      Object.fromEntries(input.customHeaders.map((header) => [header.name, header.value]))
    );
  }

  if (input.cookies.length > 0) {
    await (page as any).setCookie(...input.cookies);
  }
};

const runStep = async (page: Page, flow: any, step: BrowserAuditFlowStep, stepTimeoutMs: number) => {
  switch (step.type) {
    case 'waitForSelector':
      await page.waitForSelector(step.selector, {
        state: step.state,
        timeout: stepTimeoutMs
      } as any);
      return;
    case 'waitForUrl':
      await waitForUrl(page, step.url, step.match, stepTimeoutMs);
      return;
    case 'click':
      await page.click(step.selector, {
        timeout: stepTimeoutMs
      } as any);
      return;
    case 'type':
      if (step.clear) {
        await page.click(step.selector, {
          clickCount: 3,
          timeout: stepTimeoutMs
        } as any);
        await page.keyboard.press('Backspace');
      }
      await page.type(step.selector, step.text, {
        delay: 20
      } as any);
      return;
    case 'press':
      await page.keyboard.press(step.key as any);
      return;
    case 'select':
      await page.select(step.selector, ...step.values);
      return;
    case 'waitForTimeout':
      await Bun.sleep(step.ms);
      return;
    case 'setViewport':
      await page.setViewport({
        width: step.width,
        height: step.height,
        deviceScaleFactor: step.deviceScaleFactor,
        isMobile: step.isMobile,
        hasTouch: step.hasTouch
      });
      return;
    case 'setCookie':
      await (page as any).setCookie(step.cookie);
      return;
    case 'setExtraHeaders':
      await page.setExtraHTTPHeaders(Object.fromEntries(step.headers.map((header) => [header.name, header.value])));
      return;
    case 'snapshot':
      await flow.snapshot({
        name: step.label ?? 'snapshot'
      });
      return;
    case 'timespanStart':
      await flow.startTimespan({
        name: step.label ?? 'timespan'
      });
      return;
    case 'timespanEnd':
      await flow.endTimespan();
      return;
    case 'navigate':
      throw new Error('Navigate step must be handled by the flow coordinator');
  }
};

const waitForUrl = async (
  page: Page,
  expectedUrl: string,
  match: BrowserAuditFlowStep extends { type: 'waitForUrl'; match: infer T } ? T : string,
  timeout: number
) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    const currentUrl = page.url();

    if (
      (match === 'equals' && currentUrl === expectedUrl) ||
      (match === 'includes' && currentUrl.includes(expectedUrl)) ||
      (match === 'regex' && new RegExp(expectedUrl).test(currentUrl))
    ) {
      return;
    }

    await Bun.sleep(100);
  }

  throw new Error(`Timed out waiting for URL ${expectedUrl}`);
};

const enforceDeadline = (deadline: number, totalTimeoutMs: number) => {
  if (Date.now() > deadline) {
    throw new Error(`Audit exceeded total timeout of ${totalTimeoutMs}ms`);
  }
};

export const launchBrowser = async (
  config: BrowserAuditWorkerConfig,
  networkProxyUrl?: string
): Promise<Browser> => {
  const args = buildChromeLaunchArgs(config, networkProxyUrl);

  return puppeteer.launch({
    browser: 'chrome',
    executablePath: config.chromeExecutablePath!,
    headless: true,
    args
  });
};

export const buildChromeLaunchArgs = (
  config: Pick<BrowserAuditWorkerConfig, 'allowNoSandbox'>,
  networkProxyUrl?: string
): string[] => {
  const args = [
    '--headless=new',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check'
  ];

  if (config.allowNoSandbox) {
    args.push('--no-sandbox');
  }

  if (networkProxyUrl) {
    args.push(
      `--proxy-server=${networkProxyUrl}`,
      '--proxy-bypass-list=<-loopback>',
      '--disable-quic',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'
    );
  }

  return args;
};

const extractCheckpointResults = (
  flowResult: any,
  statusCode: number | null,
  finalUrl: string | null,
  input: BrowserAuditWorkerRequest
) => {
  const steps = Array.isArray(flowResult?.steps) ? flowResult.steps : [];

  return steps
    .map((step: any, index: number) => ({
      id: step?.name ?? `checkpoint-${index + 1}`,
      mode: normalizeStepMode(step?.mode),
      label: typeof step?.name === 'string' ? step.name : null,
      ...extractNormalizedMetrics(step, statusCode, finalUrl, input)
    }))
    .slice(0, 3);
};

const normalizeStepMode = (value: unknown): 'navigation' | 'snapshot' | 'timespan' => {
  if (value === 'timespan' || value === 'snapshot' || value === 'navigation') {
    return value;
  }

  return 'navigation';
};

const extractNormalizedMetrics = (
  step: any,
  statusCode: number | null,
  finalUrl: string | null,
  input: BrowserAuditWorkerRequest
) => {
  const lhr = step?.lhr ?? step;
  const audits = lhr?.audits ?? {};
  const categories = lhr?.categories ?? {};

  return {
    finalUrl:
      typeof lhr?.finalDisplayedUrl === 'string'
        ? redactBrowserAuditUrl(lhr.finalDisplayedUrl, input)
        : finalUrl,
    statusCode,
    scores: {
      performance: toNullableScore(categories.performance?.score),
      accessibility: toNullableScore(categories.accessibility?.score),
      bestPractices: toNullableScore(categories['best-practices']?.score),
      seo: toNullableScore(categories.seo?.score)
    },
    coreMetrics: {
      fcpMs: toNullableNumber(audits['first-contentful-paint']?.numericValue),
      lcpMs: toNullableNumber(audits['largest-contentful-paint']?.numericValue),
      cls: toNullableNumber(audits['cumulative-layout-shift']?.numericValue),
      inpMs: toNullableNumber(audits['interaction-to-next-paint']?.numericValue),
      tbtMs: toNullableNumber(audits['total-blocking-time']?.numericValue),
      speedIndexMs: toNullableNumber(audits['speed-index']?.numericValue)
    },
    extendedMetrics: extractExtendedMetrics(audits)
  };
};

const extractExtendedMetrics = (audits: Record<string, unknown>) => {
  const metrics: Array<{
    id: string;
    label: string;
    value: number;
    unit: string;
  }> = [];
  const addMetric = (id: string, label: string, value: unknown, unit: string) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      metrics.push({ id, label, value, unit });
    }
  };
  const numericAuditValue = (id: string) => {
    const audit = asAuditRecord(audits[id]);
    return audit?.numericValue;
  };
  const networkRequestDetails = asAuditRecord(
    asAuditRecord(audits['network-requests'])?.details
  );

  addMetric(
    'server-response-time-ms',
    'Server response time',
    numericAuditValue('server-response-time'),
    'ms'
  );
  addMetric(
    'transfer-size-bytes',
    'Transfer size',
    numericAuditValue('total-byte-weight'),
    'byte'
  );
  addMetric(
    'request-count',
    'Network requests',
    Array.isArray(networkRequestDetails?.items)
      ? networkRequestDetails.items.length
      : null,
    'count'
  );

  return metrics;
};

const asAuditRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const toNullableScore = (value: unknown) => (typeof value === 'number' ? value : null);
const toNullableNumber = (value: unknown) => (typeof value === 'number' ? value : null);

const uploadArtifact = async (
  input: BrowserAuditWorkerRequest,
  kind: BrowserAuditArtifactKind,
  filename: string,
  contentType: string,
  payload: Uint8Array
) => {
  if (!input.artifactUpload) {
    return [];
  }

  if (Date.parse(input.artifactUpload.expiresAt) <= Date.now()) {
    throw new Error('Artifact upload authorization expired');
  }

  if (payload.byteLength > input.artifactUpload.maxArtifactBytes) {
    throw new Error('Artifact exceeds the configured upload byte limit');
  }

  const registeredContentType = normalizeArtifactContentType(contentType);

  if (!input.artifactUpload.allowedContentTypes.includes(registeredContentType)) {
    throw new Error('Artifact content type is not allowed by the upload policy');
  }

  const response = await fetch(
    `${input.artifactUpload.baseUrl}/internal/browser-audits/${input.executionId}/artifacts?kind=${kind}&filename=${encodeURIComponent(filename)}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.artifactUpload.bearerToken}`,
        'content-type': contentType,
        'content-length': String(payload.byteLength),
        'x-artifact-size': String(payload.byteLength)
      },
      body: Buffer.from(payload),
      signal: AbortSignal.timeout(30_000)
    }
  );

  if (!response.ok) {
    throw new Error(`Artifact upload failed with ${response.status}`);
  }

  const uploaded = browserAuditArtifactRefSchema.parse(await response.json());

  if (
    uploaded.kind !== kind
    || uploaded.filename !== filename
    || normalizeArtifactContentType(uploaded.contentType) !== registeredContentType
    || uploaded.byteSize !== payload.byteLength
    || !uploaded.sha256
  ) {
    throw new Error('Artifact upload response did not match the submitted artifact');
  }

  return [uploaded];
};

const normalizeArtifactContentType = (value: string) =>
  value.split(';', 1)[0]!.trim().toLowerCase();
