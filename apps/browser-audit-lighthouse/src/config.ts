import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type BrowserAuditWorkerConfig = {
  host: string;
  port: number;
  sharedSecret?: string;
  sharedSecretNext?: string;
  allowNoSandbox: boolean;
  chromeInstallDir: string;
  chromeExecutablePath: string | null;
};

const defaultChromeRoots = [
  '/opt/chrome',
  '/usr/bin',
  '/usr/lib/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS'
];

export const getConfig = (): BrowserAuditWorkerConfig => {
  const chromeExecutablePath =
    process.env.CHROME_EXECUTABLE_PATH?.trim() || findChromeExecutable(process.env.CHROME_INSTALL_DIR?.trim());

  return {
    host: process.env.HOST?.trim() || '0.0.0.0',
    port: Number(process.env.PORT ?? '8080'),
    sharedSecret: normalizeSecret(process.env.BROWSER_AUDIT_SHARED_SECRET),
    sharedSecretNext: normalizeSecret(process.env.BROWSER_AUDIT_SHARED_SECRET_NEXT),
    allowNoSandbox: process.env.BROWSER_AUDIT_ALLOW_NO_SANDBOX === 'true',
    chromeInstallDir: process.env.CHROME_INSTALL_DIR?.trim() || '/opt/chrome',
    chromeExecutablePath
  };
};

const normalizeSecret = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const findChromeExecutable = (preferredRoot?: string) => {
  const roots = preferredRoot ? [preferredRoot, ...defaultChromeRoots] : defaultChromeRoots;

  for (const root of roots) {
    if (!existsSync(root)) {
      continue;
    }

    const discovered = walkForChrome(root, 3);

    if (discovered) {
      return discovered;
    }
  }

  return null;
};

const walkForChrome = (root: string, depth: number): string | null => {
  if (depth < 0) {
    return null;
  }

  if (statSync(root).isFile()) {
    return root.endsWith('/chrome') || root.endsWith('/Google Chrome') ? root : null;
  }

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name);

    if (
      entry.isFile() &&
      (entry.name === 'chrome' || entry.name === 'chromium' || entry.name === 'Google Chrome')
    ) {
      return fullPath;
    }

    if (entry.isDirectory()) {
      const next = walkForChrome(fullPath, depth - 1);

      if (next) {
        return next;
      }
    }
  }

  return null;
};
