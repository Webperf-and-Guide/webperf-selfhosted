import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { HTTPRequest, Page } from 'puppeteer-core';

type LookupAddress = { address: string; family: number };
type LookupHost = (hostname: string) => Promise<LookupAddress[]>;

const blockedAddresses = new BlockList();

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv4');
}

for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8]
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6');
}

export const validateBrowserRequestUrl = async (
  value: string,
  {
    allowlist = [],
    lookupHost = defaultLookupHost
  }: {
    allowlist?: string[];
    lookupHost?: LookupHost;
  } = {}
) => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('Browser request URL is invalid');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Browser request scheme ${url.protocol.replace(':', '') || 'unknown'} is blocked`);
  }

  if (url.username || url.password) {
    throw new Error('Credentials embedded in browser request URLs are blocked');
  }

  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new Error('Only browser request ports 80 and 443 are allowed');
  }

  const hostname = normalizeHostname(url.hostname);

  if (matchesAllowlist(hostname, allowlist)) {
    return url;
  }

  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
  ) {
    throw new Error(`Browser request host ${hostname} is blocked`);
  }

  const ipVersion = isIP(hostname);

  if (ipVersion > 0) {
    assertPublicAddress(hostname, ipVersion);
    return url;
  }

  let addresses: LookupAddress[];

  try {
    addresses = await lookupHost(hostname);
  } catch {
    throw new Error(`Browser request host ${hostname} could not be resolved`);
  }

  if (addresses.length === 0) {
    throw new Error(`Browser request host ${hostname} did not resolve`);
  }

  for (const address of addresses) {
    assertPublicAddress(address.address, address.family);
  }

  return url;
};

export const installBrowserNetworkGuard = async (
  page: Page,
  allowlist: string[]
) => {
  let blockedError: Error | null = null;
  await page.setRequestInterception(true);

  const handleRequest = async (request: HTTPRequest) => {
    if (request.isInterceptResolutionHandled()) {
      return;
    }

    try {
      await validateBrowserRequestUrl(request.url(), { allowlist });
      await request.continue();
    } catch (error) {
      blockedError ??= error instanceof Error ? error : new Error('Browser request blocked by network policy');
      await request.abort('blockedbyclient');
    }
  };

  page.on('request', (request) => {
    void handleRequest(request);
  });
  page.on('popup', (popup) => {
    blockedError ??= new Error('New browser windows are blocked');
    if (popup) {
      void popup.close();
    }
  });

  const session = await page.createCDPSession();
  await session.send('Browser.setDownloadBehavior', { behavior: 'deny' });

  return {
    throwIfBlocked(cause?: unknown) {
      if (blockedError) {
        throw cause === undefined
          ? blockedError
          : new Error(blockedError.message, { cause });
      }
    }
  };
};

const defaultLookupHost: LookupHost = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true }) as Promise<LookupAddress[]>;

const normalizeHostname = (hostname: string) =>
  hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();

const matchesAllowlist = (hostname: string, allowlist: string[]) =>
  allowlist.some((entry) => {
    const normalized = normalizeHostname(entry.trim());

    if (normalized.startsWith('*.')) {
      return hostname.endsWith(normalized.slice(1)) && hostname !== normalized.slice(2);
    }

    return hostname === normalized;
  });

const assertPublicAddress = (rawAddress: string, family: number) => {
  const address = normalizeMappedIpv4(rawAddress);
  const normalizedFamily = isIP(address) || family;
  const type = normalizedFamily === 4 ? 'ipv4' : 'ipv6';

  if ((normalizedFamily !== 4 && normalizedFamily !== 6) || blockedAddresses.check(address, type)) {
    throw new Error('Browser request resolved to a private, local, metadata, or reserved address');
  }
};

const normalizeMappedIpv4 = (address: string) => {
  const match = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return match?.[1] ?? address;
};
