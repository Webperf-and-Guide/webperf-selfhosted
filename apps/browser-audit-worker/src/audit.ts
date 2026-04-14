import {
  browserAuditArtifactRefSchema,
  browserAuditResultSchema,
  type BrowserAuditArtifactKind,
  type BrowserAuditArtifactRef,
  type BrowserAuditCapabilities,
  type BrowserAuditFlowStep,
  type BrowserAuditToolchain,
  type BrowserAuditWorkerRequest
} from '@webperf/contracts';
import puppeteer from 'puppeteer-core';
import type { Browser, Page } from 'puppeteer-core';
import type { BrowserAuditWorkerConfig } from './config';

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

  const browser = await launchBrowser(config);
  const page = await browser.newPage();
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
          message: error instanceof Error ? error.message : 'Failed to start tracing'
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
        finalUrl = page.url();
        navigationSeen = true;
        continue;
      }

      if (!navigationSeen) {
        throw new Error('Flow must navigate before interactive steps');
      }

      await runStep(page, flow, step, input.policy.timeouts.stepTimeoutMs);
    }

    if (input.policy.artifacts.screenshot) {
      try {
        const screenshot = (await page.screenshot({
          type: 'png',
          fullPage: true
        })) as Uint8Array;
        artifacts.push(...(await uploadArtifact(input, 'screenshot', 'screenshot.png', 'image/png', screenshot)));
      } catch (error) {
        issues.push({
          code: 'screenshot_failed',
          severity: 'warning',
          message: error instanceof Error ? error.message : 'Failed to capture screenshot'
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
          message: error instanceof Error ? error.message : 'Failed to finish tracing'
        });
      }
    }

    const rawFlowResult = (await flow.createFlowResult()) as any;
    const reportHtml = typeof flow.generateReport === 'function' ? ((await flow.generateReport()) as string) : null;

    if (input.policy.artifacts.json) {
      artifacts.push(
        ...(await uploadArtifact(
          input,
          'json',
          'flow-result.json',
          'application/json',
          new TextEncoder().encode(JSON.stringify(rawFlowResult, null, 2))
        ))
      );
    }

    if (input.policy.artifacts.html && reportHtml) {
      artifacts.push(
        ...(await uploadArtifact(
          input,
          'html',
          'report.html',
          'text/html; charset=utf-8',
          new TextEncoder().encode(reportHtml)
        ))
      );
    }

    if (traceBuffer && input.policy.artifacts.trace) {
      artifacts.push(...(await uploadArtifact(input, 'trace', 'trace.json', 'application/json', traceBuffer)));
    }

    const completedAt = new Date().toISOString();
    const checkpoints = extractCheckpointResults(rawFlowResult, responseStatusCode, finalUrl);
    const result = browserAuditResultSchema.parse({
      summary: checkpoints[0]?.summary ?? extractSummaryFromStep(rawFlowResult?.steps?.[0], responseStatusCode, finalUrl),
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
    await browser.close();
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

export const launchBrowser = async (config: BrowserAuditWorkerConfig): Promise<Browser> => {
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

  return puppeteer.launch({
    browser: 'chrome',
    executablePath: config.chromeExecutablePath!,
    headless: true,
    args
  });
};

const extractCheckpointResults = (flowResult: any, statusCode: number | null, finalUrl: string | null) => {
  const steps = Array.isArray(flowResult?.steps) ? flowResult.steps : [];

  return steps
    .map((step: any, index: number) => ({
      id: step?.name ?? `checkpoint-${index + 1}`,
      mode: normalizeStepMode(step?.mode),
      label: typeof step?.name === 'string' ? step.name : null,
      summary: extractSummaryFromStep(step, statusCode, finalUrl)
    }))
    .slice(0, 3);
};

const normalizeStepMode = (value: unknown): 'navigation' | 'snapshot' | 'timespan' => {
  if (value === 'timespan' || value === 'snapshot' || value === 'navigation') {
    return value;
  }

  return 'navigation';
};

const extractSummaryFromStep = (step: any, statusCode: number | null, finalUrl: string | null) => {
  const lhr = step?.lhr ?? step;
  const audits = lhr?.audits ?? {};
  const categories = lhr?.categories ?? {};

  return {
    finalUrl: typeof lhr?.finalDisplayedUrl === 'string' ? lhr.finalDisplayedUrl : finalUrl,
    statusCode,
    performanceScore: toNullableScore(categories.performance?.score),
    accessibilityScore: toNullableScore(categories.accessibility?.score),
    bestPracticesScore: toNullableScore(categories['best-practices']?.score),
    seoScore: toNullableScore(categories.seo?.score),
    fcpMs: toNullableNumber(audits['first-contentful-paint']?.numericValue),
    lcpMs: toNullableNumber(audits['largest-contentful-paint']?.numericValue),
    cls: toNullableNumber(audits['cumulative-layout-shift']?.numericValue),
    inpMs: toNullableNumber(audits['interaction-to-next-paint']?.numericValue),
    tbtMs: toNullableNumber(audits['total-blocking-time']?.numericValue),
    speedIndexMs: toNullableNumber(audits['speed-index']?.numericValue)
  };
};

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

  const response = await fetch(
    `${input.artifactUpload.baseUrl}/internal/browser-audits/${input.executionId}/artifacts?kind=${kind}&filename=${encodeURIComponent(filename)}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.artifactUpload.bearerToken}`,
        'content-type': contentType,
        'x-artifact-size': String(payload.byteLength)
      },
      body: Buffer.from(payload)
    }
  );

  if (!response.ok) {
    throw new Error(`Artifact upload failed with ${response.status}`);
  }

  const uploaded = await response.json();
  return [browserAuditArtifactRefSchema.parse(uploaded)];
};
