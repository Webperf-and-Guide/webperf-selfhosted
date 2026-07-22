import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type BrowserAuditWorkerConfig = {
  host: string;
  port: number;
  sharedSecret: string;
  sharedSecretNext?: string;
  allowNoSandbox: boolean;
  chromeInstallDir: string;
  chromeExecutablePath: string | null;
  hostAllowlist: string[];
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
    sharedSecret: requireSecret('BROWSER_AUDIT_SHARED_SECRET'),
    sharedSecretNext: optionalSecret('BROWSER_AUDIT_SHARED_SECRET_NEXT'),
    allowNoSandbox: process.env.BROWSER_AUDIT_ALLOW_NO_SANDBOX === 'true',
    chromeInstallDir: process.env.CHROME_INSTALL_DIR?.trim() || '/opt/chrome',
    chromeExecutablePath,
    hostAllowlist: (process.env.BROWSER_AUDIT_HOST_ALLOWLIST ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  };
};

const normalizeSecret = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const requireSecret = (name: string) => {
  const value = normalizeSecret(process.env[name]);

  if (!value || value.length < 16) {
    throw new Error(`${name} is required and must contain at least 16 characters`);
  }

  return value;
};

const optionalSecret = (name: string) => {
  const value = normalizeSecret(process.env[name]);

  if (value && value.length < 16) {
    throw new Error(`${name} must contain at least 16 characters when configured`);
  }

  return value;
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
