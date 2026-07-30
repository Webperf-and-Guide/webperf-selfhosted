import { isIP } from 'node:net';

export const standaloneSecretNames = [
  'SELFHOST_ADMIN_TOKEN',
  'SELFHOST_ADMIN_TOKEN_NEXT',
  'SELFHOST_INTERNAL_SECRET',
  'SELFHOST_INTERNAL_SECRET_NEXT',
  'PROBE_SHARED_SECRET',
  'PROBE_SHARED_SECRET_NEXT',
  'BROWSER_AUDIT_SHARED_SECRET',
  'BROWSER_AUDIT_SHARED_SECRET_NEXT'
] as const;

export type StandaloneSecretName = typeof standaloneSecretNames[number];
export type StandaloneSecrets = Partial<Record<StandaloneSecretName, string>>;
type Environment = Record<string, string | undefined>;

const hostnamePattern =
  /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/;
const maximumStartupTimeoutMs = 24 * 60 * 60 * 1_000;
const startupTimeoutErrorMessage =
  `WEBPERF_STANDALONE_STARTUP_TIMEOUT_MS must be 0 or an integer up to ${maximumStartupTimeoutMs}`;

/**
 * Extracts standalone secrets and removes them from the provided environment
 * so a later environment spread cannot leak them into child processes.
 */
export const takeStandaloneSecrets = (environment: Environment): StandaloneSecrets => {
  const secrets: StandaloneSecrets = {};

  for (const name of standaloneSecretNames) {
    const value = environment[name];
    if (value !== undefined) {
      secrets[name] = value;
    }
    delete environment[name];
  }

  return secrets;
};

export const selectStandaloneSecrets = (
  secrets: StandaloneSecrets,
  names: readonly StandaloneSecretName[]
): Record<string, string> => Object.fromEntries(
  names.flatMap((name) => {
    const value = secrets[name];
    return value === undefined ? [] : [[name, value]];
  })
);

export const resolveStandaloneApiBinding = (
  rawHost: string | undefined,
  port: number
) => {
  const configuredHost = rawHost?.trim() || '0.0.0.0';
  const unbracketedHost = configuredHost.startsWith('[') && configuredHost.endsWith(']')
    ? configuredHost.slice(1, -1)
    : configuredHost;
  const ipVersion = isIP(unbracketedHost);

  if (
    ipVersion === 0
    && !hostnamePattern.test(unbracketedHost)
  ) {
    throw new Error('SELFHOST_API_HOST must be an IP address or hostname without a scheme or port');
  }
  if (
    configuredHost !== unbracketedHost
    && ipVersion !== 6
  ) {
    throw new Error('SELFHOST_API_HOST brackets are allowed only for an IPv6 address');
  }

  const bindHost = unbracketedHost;
  let connectHost = bindHost;
  if (bindHost === '0.0.0.0') {
    connectHost = '127.0.0.1';
  } else if (bindHost === '::') {
    connectHost = '::1';
  }
  const urlHost = isIP(connectHost) === 6 ? `[${connectHost}]` : connectHost;

  return {
    bindHost,
    origin: `http://${urlHost}:${port}`
  };
};

export const parseStandaloneStartupTimeoutMs = (
  raw: string | undefined
): number => {
  const value = raw?.trim() || '0';
  if (!/^\d{1,8}$/.test(value)) {
    throw new Error(startupTimeoutErrorMessage);
  }

  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed)
    || parsed < 0
    || parsed > maximumStartupTimeoutMs
  ) {
    throw new Error(startupTimeoutErrorMessage);
  }

  return parsed;
};
