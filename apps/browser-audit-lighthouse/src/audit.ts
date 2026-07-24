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
import { createHash } from 'node:crypto';
import puppeteer from 'puppeteer-core';
import type { Browser, Page, WaitForSelectorOptions } from 'puppeteer-core';
import { RE2JS } from 're2js';
import type { BrowserAuditWorkerConfig } from './config';
import { installBrowserNetworkGuard, validateBrowserRequestUrl } from './network-policy';
import { startBrowserNetworkProxy } from './network-proxy';
import { isPuppeteerKeyInput } from './puppeteer-key-input';
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
const defaultTypingDelayMs = 20;

type LighthouseUserFlow = {
  navigate(requestor: () => Promise<void>, options?: { name?: string }): Promise<void>;
  snapshot(options?: { name?: string }): Promise<void>;
  startTimespan(options?: { name?: string }): Promise<void>;
  endTimespan(): Promise<void>;
  createFlowResult(): Promise<unknown>;
  generateReport?: () => Promise<string>;
};

type LighthouseUserFlowConstructor = new (
  page: Page,
  options?: { name?: string }
) => LighthouseUserFlow;
type WaitForUrlMatch = Extract<
  BrowserAuditFlowStep,
  { type: 'waitForUrl' }
>['match'];
export const lighthouseArtifactContentTypes = {
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

  const deadline = Date.now() + input.policy.timeouts.totalTimeoutMs;

  await validateBrowserRequestUrl(input.targetUrl, { allowlist: config.hostAllowlist });

  for (const step of input.policy.flow.steps) {
    if (step.type === 'navigate' && step.url) {
      await validateBrowserRequestUrl(step.url, { allowlist: config.hostAllowlist });
    }
  }

  const networkProxy = await startBrowserNetworkProxy({
    allowlist: config.hostAllowlist,
    onDiagnostic(diagnostic) {
      console.warn(JSON.stringify({
        service: 'webperf-browser-audit-lighthouse',
        ...diagnostic
      }));
    }
  });
  let browser: Browser;
  try {
    browser = await launchBrowser(config, networkProxy.url);
  } catch (error) {
    await closeWithDiagnostic('network_proxy_close_failed', () => networkProxy.close());
    throw error;
  }
  let page: Page;
  try {
    page = await browser.newPage();
  } catch (error) {
    await closeWithDiagnostic('browser_close_failed', () => browser.close());
    await closeWithDiagnostic('network_proxy_close_failed', () => networkProxy.close());
    throw error;
  }
  let networkGuard: Awaited<ReturnType<typeof installBrowserNetworkGuard>>;
  try {
    networkGuard = await installBrowserNetworkGuard(page, config.hostAllowlist);
  } catch (error) {
    await closeWithDiagnostic('page_close_failed', () => page.close());
    await closeWithDiagnostic('browser_close_failed', () => browser.close());
    await closeWithDiagnostic('network_proxy_close_failed', () => networkProxy.close());
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
      UserFlow?: LighthouseUserFlowConstructor;
      default?: LighthouseUserFlowConstructor;
    };
    const UserFlow = importedFlow.UserFlow ?? importedFlow.default;

    if (typeof UserFlow !== 'function') {
      throw new Error('Lighthouse user-flow API is unavailable');
    }

    const flow = new UserFlow(page, {
      name: input.executionId
    });

    await applySetupState(page, input);

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
              });
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

      await runWithinAuditDeadline(
        () => runStep(
          page,
          flow,
          step,
          input.policy.timeouts.stepTimeoutMs,
          input
        ),
        deadline,
        input.policy.timeouts.totalTimeoutMs
      );
      networkGuard.throwIfBlocked();
    }

    if (input.policy.artifacts.screenshot) {
      try {
        const screenshot = (await runWithinAuditDeadline(
          () => page.screenshot({
            type: 'png',
            fullPage: true
          }),
          deadline,
          input.policy.timeouts.totalTimeoutMs
        )) as Uint8Array;
        artifacts.push(...(await uploadArtifact(
          input,
          'screenshot',
          'screenshot.png',
          lighthouseArtifactContentTypes.screenshot,
          screenshot,
          { deadline }
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
        traceBuffer = (await runWithinAuditDeadline(
          () => tracingApi.stop(),
          deadline,
          input.policy.timeouts.totalTimeoutMs
        )) ?? null;
      } catch (error) {
        issues.push({
          code: 'trace_stop_failed',
          severity: 'warning',
          message: redactBrowserAuditText(error instanceof Error ? error.message : 'Failed to finish tracing', input)
        });
      }
    }

    const rawFlowResult = await runWithinAuditDeadline(
      () => flow.createFlowResult(),
      deadline,
      input.policy.timeouts.totalTimeoutMs
    );
    networkGuard.throwIfBlocked();
    const generateReport = flow.generateReport?.bind(flow);
    const reportHtml = input.policy.artifacts.html && generateReport
      ? await runWithinAuditDeadline(
        generateReport,
        deadline,
        input.policy.timeouts.totalTimeoutMs
      )
      : null;

    if (input.policy.artifacts.json) {
      const serializedFlowResult = serializeFlowResult(rawFlowResult);
      artifacts.push(
        ...(await uploadArtifact(
          input,
          'lighthouse-json',
          'flow-result.json',
          lighthouseArtifactContentTypes.json,
          new TextEncoder().encode(redactBrowserAuditText(serializedFlowResult, input)),
          { deadline }
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
          new TextEncoder().encode(redactBrowserAuditText(reportHtml, input)),
          { deadline }
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
          redactBrowserAuditBytesInPlace(traceBuffer, input),
          { deadline }
        ))
      );
    }

    const completedAt = new Date().toISOString();
    const checkpoints = extractCheckpointResults(rawFlowResult, responseStatusCode, finalUrl, input);
    const primaryCheckpoint =
      checkpoints[0]
      ?? extractNormalizedMetrics(
        getFlowSteps(rawFlowResult)[0],
        responseStatusCode,
        finalUrl,
        input
      );
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
    await closeWithDiagnostic('page_close_failed', () => page.close());
    await closeWithDiagnostic('browser_close_failed', () => browser.close());
    await closeWithDiagnostic('network_proxy_close_failed', () => networkProxy.close());
  }
};

const applySetupState = async (page: Page, input: BrowserAuditWorkerRequest) => {
  if (input.customHeaders.length > 0) {
    await page.setExtraHTTPHeaders(
      Object.fromEntries(input.customHeaders.map((header) => [header.name, header.value]))
    );
  }

  if (input.cookies.length > 0) {
    await page.setCookie(...input.cookies);
  }
};

const runStep = async (
  page: Page,
  flow: LighthouseUserFlow,
  step: BrowserAuditFlowStep,
  stepTimeoutMs: number,
  input: BrowserAuditWorkerRequest
) => {
  switch (step.type) {
    case 'waitForSelector':
      if (step.state === 'detached') {
        await waitForDetachedSelector(page, step.selector, stepTimeoutMs);
        return;
      }
      await page.waitForSelector(step.selector, {
        ...selectorStateOptions(step.state),
        timeout: stepTimeoutMs
      });
      return;
    case 'waitForUrl':
      await waitForUrl(page, step.url, step.match, stepTimeoutMs, input);
      return;
    case 'click':
      await waitForInteractiveSelector(page, step.selector, stepTimeoutMs);
      await page.click(step.selector);
      return;
    case 'type':
      await waitForInteractiveSelector(page, step.selector, stepTimeoutMs);
      if (step.clear) {
        await clearBrowserAuditField(page, step.selector);
      }
      await page.type(step.selector, step.text, {
        delay: defaultTypingDelayMs
      });
      return;
    case 'press':
      if (!isPuppeteerKeyInput(step.key)) {
        throw new Error('Press step key is unsupported by the Lighthouse runner');
      }
      await page.keyboard.press(step.key);
      return;
    case 'select':
      await page.waitForSelector(step.selector, { timeout: stepTimeoutMs });
      await page.select(step.selector, ...step.values);
      return;
    case 'waitForTimeout':
      assertWaitForTimeoutWithinStepLimit(step.ms, stepTimeoutMs);
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
      await page.setCookie(step.cookie);
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

const selectorStateOptions = (
  state: Extract<BrowserAuditFlowStep, { type: 'waitForSelector' }>['state']
): WaitForSelectorOptions => {
  if (state === 'visible') {
    return { visible: true };
  }
  if (state === 'hidden') {
    return { hidden: true };
  }
  return {};
};

const waitForInteractiveSelector = async (
  page: Page,
  selector: string,
  timeout: number
) => {
  await page.waitForSelector(selector, { visible: true, timeout });
};

export const clearBrowserAuditField = async (
  page: Pick<Page, 'click' | 'keyboard'>,
  selector: string
) => {
  await page.click(selector);
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.down(modifier);
  try {
    await page.keyboard.press('a');
  } finally {
    await page.keyboard.up(modifier);
  }
  await page.keyboard.press('Backspace');
};

export const assertWaitForTimeoutWithinStepLimit = (
  waitMs: number,
  stepTimeoutMs: number
) => {
  if (waitMs > stepTimeoutMs) {
    throw new Error(
      `Wait step exceeds the per-step timeout of ${stepTimeoutMs}ms`
    );
  }
};

export const waitForDetachedSelector = async (
  page: Pick<Page, '$'>,
  selector: string,
  timeout: number
) => {
  const deadline = Date.now() + timeout;

  while (true) {
    const handle = await page.$(selector);
    if (!handle) {
      return;
    }
    await handle.dispose();

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(`Timed out waiting for selector ${selector} to detach`);
    }
    await Bun.sleep(Math.min(50, remainingMs));
  }
};

const waitForUrl = async (
  page: Page,
  expectedUrl: string,
  match: WaitForUrlMatch,
  timeout: number,
  input: BrowserAuditWorkerRequest
) => {
  const startedAt = Date.now();
  const matches = createWaitForUrlMatcher(expectedUrl, match);

  while (Date.now() - startedAt < timeout) {
    const currentUrl = page.url();

    if (matches(currentUrl)) {
      return;
    }

    await Bun.sleep(100);
  }

  throw new Error(
    redactBrowserAuditText(`Timed out waiting for the configured URL ${match} condition`, input)
  );
};

export const createWaitForUrlMatcher = (
  expectedUrl: string,
  match: WaitForUrlMatch
): ((currentUrl: string) => boolean) => {
  if (match === 'equals') {
    return (currentUrl) => currentUrl === expectedUrl;
  }
  if (match === 'includes') {
    return (currentUrl) => currentUrl.includes(expectedUrl);
  }
  if (match !== 'regex') {
    throw new Error('waitForUrl match mode is unsupported');
  }

  let pattern: RE2JS;
  try {
    pattern = RE2JS.compile(expectedUrl);
  } catch {
    throw new Error('waitForUrl regex is invalid or unsupported');
  }
  return (currentUrl) => pattern.test(currentUrl);
};

const closeWithDiagnostic = async (
  event: 'page_close_failed' | 'browser_close_failed' | 'network_proxy_close_failed',
  close: () => Promise<void>
) => {
  try {
    await close();
  } catch (error) {
    const candidate = error as { name?: unknown; code?: unknown } | null;
    console.warn(JSON.stringify({
      service: 'webperf-browser-audit-lighthouse',
      event,
      errorType: typeof candidate?.name === 'string'
        && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(candidate.name)
          ? candidate.name
          : 'UnknownError',
      errorCode: typeof candidate?.code === 'string'
        && /^[A-Z][A-Z0-9_]{0,79}$/.test(candidate.code)
          ? candidate.code
          : null
    }));
  }
};

const enforceDeadline = (deadline: number, totalTimeoutMs: number) => {
  if (Date.now() >= deadline) {
    throw auditTimeoutError(totalTimeoutMs);
  }
};

const auditTimeoutError = (totalTimeoutMs: number) =>
  new Error(`Audit exceeded total timeout of ${totalTimeoutMs}ms`);

export const runWithinAuditDeadline = async <Result>(
  operation: () => Promise<Result>,
  deadline: number,
  totalTimeoutMs: number,
  now: () => number = Date.now
): Promise<Result> => {
  const remainingMs = deadline - now();
  if (remainingMs <= 0) {
    throw auditTimeoutError(totalTimeoutMs);
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const pending = Promise.resolve().then(operation);
  // The browser is closed by the caller after a timeout, but the dependency
  // promise can still reject later. Keep that late settlement observed.
  void pending.catch(() => undefined);

  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(auditTimeoutError(totalTimeoutMs)),
          remainingMs
        );
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

export const launchBrowser = async (
  config: BrowserAuditWorkerConfig,
  networkProxyUrl?: string
): Promise<Browser> => {
  if (!config.chromeExecutablePath) {
    throw new Error('Chrome executable is not configured');
  }
  const args = buildChromeLaunchArgs(config, networkProxyUrl);

  return puppeteer.launch({
    browser: 'chrome',
    executablePath: config.chromeExecutablePath,
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
    '--disable-setuid-sandbox',
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
  flowResult: unknown,
  statusCode: number | null,
  finalUrl: string | null,
  input: BrowserAuditWorkerRequest
) => {
  const steps = getFlowSteps(flowResult);

  return steps
    .map((step, index) => {
      const stepRecord = asAuditRecord(step);
      const lhr = asAuditRecord(stepRecord?.lhr);
      const name = typeof stepRecord?.name === 'string'
        ? stepRecord.name
        : `checkpoint-${index + 1}`;
      return {
        id: name,
        mode: normalizeStepMode(lhr?.gatherMode ?? stepRecord?.mode),
        label: typeof stepRecord?.name === 'string' ? name : null,
        ...extractNormalizedMetrics(step, statusCode, finalUrl, input)
      };
    })
    .slice(0, 3);
};

const getFlowSteps = (flowResult: unknown): unknown[] => {
  const flowRecord = asAuditRecord(flowResult);
  return Array.isArray(flowRecord?.steps) ? flowRecord.steps : [];
};

const normalizeStepMode = (value: unknown): 'navigation' | 'snapshot' | 'timespan' => {
  if (value === 'timespan' || value === 'snapshot' || value === 'navigation') {
    return value;
  }

  return 'navigation';
};

const extractNormalizedMetrics = (
  step: unknown,
  statusCode: number | null,
  finalUrl: string | null,
  input: BrowserAuditWorkerRequest
) => {
  const stepRecord = asAuditRecord(step);
  const lhr = asAuditRecord(stepRecord?.lhr) ?? stepRecord;
  const audits: Record<string, unknown> = asAuditRecord(lhr?.audits) ?? {};
  const categories: Record<string, unknown> = asAuditRecord(lhr?.categories) ?? {};
  const categoryScore = (id: string) => asAuditRecord(categories[id])?.score;
  const auditNumericValue = (id: string) => asAuditRecord(audits[id])?.numericValue;

  return {
    finalUrl:
      typeof lhr?.finalDisplayedUrl === 'string'
        ? redactBrowserAuditUrl(lhr.finalDisplayedUrl, input)
        : finalUrl,
    statusCode,
    scores: {
      performance: toNullableScore(categoryScore('performance')),
      accessibility: toNullableScore(categoryScore('accessibility')),
      bestPractices: toNullableScore(categoryScore('best-practices')),
      seo: toNullableScore(categoryScore('seo'))
    },
    coreMetrics: {
      fcpMs: toNullableNumber(auditNumericValue('first-contentful-paint')),
      lcpMs: toNullableNumber(auditNumericValue('largest-contentful-paint')),
      cls: toNullableNumber(auditNumericValue('cumulative-layout-shift')),
      inpMs: toNullableNumber(auditNumericValue('interaction-to-next-paint')),
      tbtMs: toNullableNumber(auditNumericValue('total-blocking-time')),
      speedIndexMs: toNullableNumber(auditNumericValue('speed-index'))
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

export const serializeFlowResult = (value: unknown): string => {
  try {
    const serialized = JSON.stringify(value, null, 2);
    if (serialized !== undefined) {
      return serialized;
    }
  } catch (error) {
    // Normalize dependency payload failures without reflecting their contents.
    throw new Error('Lighthouse flow result could not be serialized', { cause: error });
  }
  throw new Error('Lighthouse flow result could not be serialized');
};

type ArtifactFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

type ArtifactUploadOptions = {
  fetchImpl?: ArtifactFetch;
  deadline?: number;
  now?: () => number;
};

export const uploadArtifact = async (
  input: BrowserAuditWorkerRequest,
  kind: BrowserAuditArtifactKind,
  filename: string,
  contentType: string,
  payload: Uint8Array,
  options: ArtifactUploadOptions = {}
) => {
  if (!input.artifactUpload) {
    return [];
  }

  const now = options.now ?? Date.now;
  const currentTime = now();
  const authorizationExpiresAt = Date.parse(input.artifactUpload.expiresAt);

  if (authorizationExpiresAt <= currentTime) {
    throw new Error('Artifact upload authorization expired');
  }

  const deadline = options.deadline
    ?? currentTime + input.policy.timeouts.totalTimeoutMs;
  const remainingAuditMs = deadline - currentTime;
  if (remainingAuditMs <= 0) {
    throw new Error(
      `Audit exceeded total timeout of ${input.policy.timeouts.totalTimeoutMs}ms`
    );
  }

  if (payload.byteLength > input.artifactUpload.maxArtifactBytes) {
    throw new Error('Artifact exceeds the configured upload byte limit');
  }

  const registeredContentType = normalizeArtifactContentType(contentType);

  if (!input.artifactUpload.allowedContentTypes.includes(registeredContentType)) {
    throw new Error('Artifact content type is not allowed by the upload policy');
  }

  const uploadBody: Uint8Array<ArrayBuffer> = payload.buffer instanceof ArrayBuffer
    ? new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
    : Uint8Array.from(payload);

  const response = await (options.fetchImpl ?? fetch)(
    `${input.artifactUpload.baseUrl}/internal/browser-audits/${encodeURIComponent(input.executionId)}/artifacts?kind=${encodeURIComponent(kind)}&filename=${encodeURIComponent(filename)}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.artifactUpload.bearerToken}`,
        'content-type': contentType,
        'content-length': String(payload.byteLength),
        'x-artifact-size': String(payload.byteLength)
      },
      body: uploadBody,
      signal: AbortSignal.timeout(
        Math.min(remainingAuditMs, authorizationExpiresAt - currentTime)
      )
    }
  );

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Artifact upload failed with ${response.status}`);
  }

  const uploaded = browserAuditArtifactRefSchema.parse(await response.json());
  const expectedSha256 = createHash('sha256').update(payload).digest('hex');

  if (
    uploaded.kind !== kind
    || uploaded.filename !== filename
    || normalizeArtifactContentType(uploaded.contentType) !== registeredContentType
    || uploaded.byteSize !== payload.byteLength
    || uploaded.sha256 !== expectedSha256
  ) {
    throw new Error('Artifact upload response did not match the submitted artifact');
  }

  return [uploaded];
};

const normalizeArtifactContentType = (value: string) =>
  value.split(';', 1)[0]!.trim().toLowerCase();
