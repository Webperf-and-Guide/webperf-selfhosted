import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { HTTPRequest, Page } from 'puppeteer-core';

export type LookupAddress = { address: string; family: number };
export type LookupHost = (hostname: string) => Promise<LookupAddress[]>;

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
  ['::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8]
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6');
}

export type ResolvedBrowserRequestTarget = {
  url: URL;
  address: string;
  family: 4 | 6;
  allowlisted: boolean;
};

export const validateBrowserRequestUrl = async (
  value: string,
  {
    allowlist = [],
    lookupHost = defaultLookupHost
  }: {
    allowlist?: string[];
    lookupHost?: LookupHost;
  } = {}
): Promise<URL> => (await resolveBrowserRequestTarget(value, {
  allowlist,
  lookupHost
})).url;

export const resolveBrowserRequestTarget = async (
  value: string,
  {
    allowlist = [],
    lookupHost = defaultLookupHost
  }: {
    allowlist?: string[];
    lookupHost?: LookupHost;
  } = {}
): Promise<ResolvedBrowserRequestTarget> => {
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
  const allowlisted = matchesAllowlist(hostname, allowlist);

  if (
    !allowlisted
    && (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    )
  ) {
    throw new Error(`Browser request host ${hostname} is blocked`);
  }

  const ipVersion = isIP(hostname);

  if (ipVersion > 0) {
    if (!allowlisted) {
      assertPublicAddress(hostname);
    }
    return { url, address: hostname, family: ipVersion as 4 | 6, allowlisted };
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

  const normalizedAddresses = addresses.map((address) => {
    const family = isIP(address.address);
    if (family !== 4 && family !== 6) {
      throw new Error(`Browser request host ${hostname} returned an invalid address`);
    }
    return { address: address.address, family: family as 4 | 6 };
  });

  if (!allowlisted) {
    for (const address of normalizedAddresses) {
      assertPublicAddress(address.address);
    }
  }

  return { url, ...normalizedAddresses[0]!, allowlisted };
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
    void handleRequest(request).catch(async (error) => {
      blockedError ??= error instanceof Error
        ? error
        : new Error('Browser request interceptor failed');
      if (!request.isInterceptResolutionHandled()) {
        try {
          await request.abort('blockedbyclient');
        } catch {}
      }
    });
  });
  page.on('popup', (popup) => {
    blockedError ??= new Error('New browser windows are blocked');
    if (popup) {
      void popup.close();
    }
  });
  page.browser().on('targetcreated', (target) => {
    if (target === page.target() || target.type() !== 'page') {
      return;
    }

    void (async () => {
      blockedError ??= new Error('New browser windows are blocked');
      const popup = await target.page();
      if (!popup) {
        return;
      }
      await popup.setRequestInterception(true);
      popup.on('request', (request) => {
        if (!request.isInterceptResolutionHandled()) {
          void request.abort('blockedbyclient').catch(() => undefined);
        }
      });
      await popup.close();
    })().catch((error) => {
      blockedError ??= error instanceof Error
        ? error
        : new Error('Failed to close a new browser window');
    });
  });

  const session = await page.createCDPSession();
  await session.send('Page.setDownloadBehavior', { behavior: 'deny' });

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

const assertPublicAddress = (rawAddress: string) => {
  const address = normalizeMappedIpv4(rawAddress);
  const normalizedFamily = isIP(address);
  const type = normalizedFamily === 4 ? 'ipv4' : 'ipv6';

  if ((normalizedFamily !== 4 && normalizedFamily !== 6) || blockedAddresses.check(address, type)) {
    throw new Error('Browser request resolved to a private, local, metadata, or reserved address');
  }
};

const normalizeMappedIpv4 = (address: string) => {
  const normalized = address.toLowerCase();
  const dotted = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted?.[1]) {
    return dotted[1];
  }

  const hex = normalized.match(
    /^(?:::ffff:|(?:0{1,4}:){5}ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/
  );
  if (!hex?.[1] || !hex[2]) {
    return address;
  }

  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
};
