import {
  browserAuditCapabilitiesSchema,
  browserAuditDslVersion,
  type BrowserAuditCapabilities,
  type BrowserAuditToolchain
} from '@webperf/contracts';
import type { BrowserAuditWorkerConfig } from './config';

type StartupCheck = {
  ok: boolean;
  checkedAt: string;
  errors: string[];
  toolchain: BrowserAuditToolchain;
};

const readJson = async <T>(specifier: string) => (await import(specifier, { with: { type: 'json' } })).default as T;

export const buildStartupCheck = async (config: BrowserAuditWorkerConfig): Promise<StartupCheck> => {
  const [workerPackage, lighthousePackage, puppeteerPackage] = await Promise.all([
    readJson<{ version: string }>('../package.json'),
    readJson<{ version: string }>('lighthouse/package.json'),
    readJson<{ version: string }>('puppeteer-core/package.json')
  ]);
  const errors: string[] = [];
  const chromeVersion = config.chromeExecutablePath ? await readChromeVersion(config.chromeExecutablePath) : null;

  if (!config.chromeExecutablePath) {
    errors.push(`Chrome executable not found under ${config.chromeInstallDir}`);
  }

  try {
    const imported = await import('lighthouse/core/user-flow.js');

    if (
      typeof (imported as { UserFlow?: unknown }).UserFlow !== 'function' &&
      typeof (imported as { default?: unknown }).default !== 'function'
    ) {
      errors.push('Lighthouse user-flow entrypoint is missing UserFlow');
    }
  } catch (error) {
    errors.push(error instanceof Error ? `Failed to import lighthouse user-flow API: ${error.message}` : 'Failed to import lighthouse user-flow API');
  }

  const toolchain = {
    flowDslVersion: browserAuditDslVersion,
    bunVersion: Bun.version,
    chromeVersion: chromeVersion ?? 'unavailable',
    puppeteerVersion: puppeteerPackage.version,
    lighthouseVersion: lighthousePackage.version
  } satisfies BrowserAuditToolchain;

  return {
    ok: errors.length === 0,
    checkedAt: new Date().toISOString(),
    errors,
    toolchain
  };
};

export const buildCapabilities = (toolchain: BrowserAuditToolchain): BrowserAuditCapabilities =>
  browserAuditCapabilitiesSchema.parse({
    flowDslVersion: browserAuditDslVersion,
    toolchain,
    supportedCheckpointModes: ['navigation', 'snapshot', 'timespan'],
    supportedArtifactKinds: ['json', 'html', 'screenshot', 'trace'],
    unsupportedFeatures: [
      'arbitrary_js_eval',
      'file_upload',
      'multi_tab',
      'extension_loading',
      'tenant_supplied_launch_flags'
    ],
    limits: {
      maxSteps: 20,
      maxCheckpoints: 3,
      maxPages: 1,
      maxContexts: 1,
      maxArtifactBytes: 25_000_000,
      defaultTotalTimeoutMs: 120_000,
      defaultStepTimeoutMs: 10_000
    }
  });

const readChromeVersion = async (executablePath: string) => {
  const process = Bun.spawn([executablePath, '--version'], {
    stdout: 'pipe',
    stderr: 'pipe'
  });
  const output = await new Response(process.stdout).text();
  const errorOutput = await new Response(process.stderr).text();
  await process.exited;

  const combined = `${output}\n${errorOutput}`.trim();
  return combined.length > 0 ? combined : null;
};
