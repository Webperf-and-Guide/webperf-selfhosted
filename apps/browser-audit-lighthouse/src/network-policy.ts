import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { HTTPRequest, Page } from 'puppeteer-core';

export type LookupAddress = { address: string; family: number };
export type LookupHost = (hostname: string) => Promise<LookupAddress[]>;

export class BrowserNetworkPolicyError extends Error {
  override name = 'BrowserNetworkPolicyError';
}

const blockedAddresses = new BlockList();
const blockedUnnormalizedMappedAddresses = new BlockList();
const maxBlockedErrors = 8;
const defaultDnsLookupTimeoutMs = 10_000;

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
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8]
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6');
}

// Node's BlockList treats an IPv6 mapped-address subnet as matching every
// IPv4 input too. Keep this fallback isolated and consult it only when mapped
// normalization unexpectedly leaves a value as IPv6.
blockedUnnormalizedMappedAddresses.addSubnet('::ffff:0:0', 96, 'ipv6');

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
    lookupHost = defaultLookupHost,
    lookupTimeoutMs = defaultDnsLookupTimeoutMs
  }: {
    allowlist?: string[];
    lookupHost?: LookupHost;
    lookupTimeoutMs?: number;
  } = {}
): Promise<URL> => (await resolveBrowserRequestTarget(value, {
  allowlist,
  lookupHost,
  lookupTimeoutMs
})).url;

export const resolveBrowserRequestTarget = async (
  value: string,
  {
    allowlist = [],
    lookupHost = defaultLookupHost,
    lookupTimeoutMs = defaultDnsLookupTimeoutMs
  }: {
    allowlist?: string[];
    lookupHost?: LookupHost;
    lookupTimeoutMs?: number;
  } = {}
): Promise<ResolvedBrowserRequestTarget> => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new BrowserNetworkPolicyError('Browser request URL is invalid');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BrowserNetworkPolicyError(
      `Browser request scheme ${url.protocol.replace(':', '') || 'unknown'} is blocked`
    );
  }

  if (url.username || url.password) {
    throw new BrowserNetworkPolicyError('Credentials embedded in browser request URLs are blocked');
  }

  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new BrowserNetworkPolicyError('Only browser request ports 80 and 443 are allowed');
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
    throw new BrowserNetworkPolicyError(`Browser request host ${hostname} is blocked`);
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
    addresses = await lookupHostWithTimeout(hostname, lookupHost, lookupTimeoutMs);
  } catch {
    throw new BrowserNetworkPolicyError(`Browser request host ${hostname} could not be resolved`);
  }

  if (addresses.length === 0) {
    throw new BrowserNetworkPolicyError(`Browser request host ${hostname} did not resolve`);
  }

  const normalizedAddresses = addresses.map((address) => {
    const family = isIP(address.address);
    if (family !== 4 && family !== 6) {
      throw new BrowserNetworkPolicyError(
        `Browser request host ${hostname} returned an invalid address`
      );
    }
    return { address: address.address, family: family as 4 | 6 };
  });

  if (!allowlisted) {
    for (const address of normalizedAddresses) {
      assertPublicAddress(address.address);
    }
  }

  const selectedAddress = normalizedAddresses[0];
  if (!selectedAddress) {
    throw new BrowserNetworkPolicyError(`Browser request host ${hostname} did not resolve`);
  }
  return { url, ...selectedAddress, allowlisted };
};

export const installBrowserNetworkGuard = async (
  page: Page,
  allowlist: string[]
) => {
  const blockedErrors: Error[] = [];
  const recordBlockedError = (error: unknown, fallback: string) => {
    const normalized = error instanceof Error ? error : new Error(fallback);
    if (
      blockedErrors.length < maxBlockedErrors
      && !blockedErrors.some((existing) => existing.message === normalized.message)
    ) {
      blockedErrors.push(normalized);
    }
  };
  await page.setRequestInterception(true);

  const handleRequest = async (request: HTTPRequest) => {
    if (request.isInterceptResolutionHandled()) {
      return;
    }

    try {
      await validateBrowserRequestUrl(request.url(), { allowlist });
      await request.continue();
    } catch (error) {
      recordBlockedError(error, 'Browser request blocked by network policy');
      try {
        await request.abort('blockedbyclient');
      } catch (abortError) {
        recordBlockedError(abortError, 'Browser request abort failed');
      }
    }
  };

  page.on('request', (request) => {
    void handleRequest(request).catch(async (error) => {
      recordBlockedError(error, 'Browser request interceptor failed');
      if (!request.isInterceptResolutionHandled()) {
        try {
          await request.abort('blockedbyclient');
        } catch (abortError) {
          recordBlockedError(abortError, 'Browser request abort failed');
        }
      }
    });
  });
  page.on('popup', (popup) => {
    recordBlockedError(
      new Error('New browser windows are blocked'),
      'New browser windows are blocked'
    );
    if (popup) {
      void popup.close().catch((error) => {
        recordBlockedError(error, 'Failed to close a new browser window');
      });
    }
  });
  page.browser().on('targetcreated', (target) => {
    if (target === page.target() || target.type() !== 'page') {
      return;
    }

    // The pinned forward proxy is the authoritative guard for the popup's first
    // request; target interception below is defense in depth once CDP exposes it.
    void (async () => {
      recordBlockedError(
        new Error('New browser windows are blocked'),
        'New browser windows are blocked'
      );
      const popup = await target.page();
      if (!popup) {
        return;
      }
      await popup.setRequestInterception(true);
      popup.on('request', (request) => {
        if (!request.isInterceptResolutionHandled()) {
          void request.abort('blockedbyclient').catch((error) => {
            recordBlockedError(error, 'Popup request abort failed');
          });
        }
      });
      await popup.close();
    })().catch((error) => {
      recordBlockedError(error, 'Failed to close a new browser window');
    });
  });

  const session = await page.createCDPSession();
  await session.send('Page.setDownloadBehavior', { behavior: 'deny' });

  return {
    throwIfBlocked(cause?: unknown) {
      const [primaryError, ...additionalErrors] = blockedErrors;
      if (!primaryError) {
        return;
      }

      const causes = cause === undefined
        ? additionalErrors
        : [cause, ...additionalErrors];
      if (causes.length === 0) {
        throw primaryError;
      }
      throw new AggregateError(
        [primaryError, ...causes],
        primaryError.message,
        { cause: primaryError }
      );
    }
  };
};

const defaultLookupHost: LookupHost = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true }) as Promise<LookupAddress[]>;

const lookupHostWithTimeout = async (
  hostname: string,
  lookupHost: LookupHost,
  timeoutMs: number
) => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error('Browser DNS lookup timeout must be between 1 and 60000ms');
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const lookupPromise = lookupHost(hostname);
  // Promise.race installs a rejection handler, but retain an explicit observer
  // so a DNS implementation that settles after the timeout stays harmless.
  void lookupPromise.catch(() => undefined);
  try {
    return await Promise.race([
      lookupPromise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Browser DNS lookup timed out')),
          timeoutMs
        );
        timeout.unref?.();
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const normalizeHostname = (hostname: string) =>
  hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();

const matchesAllowlist = (hostname: string, allowlist: string[]) =>
  allowlist.some((entry) => {
    const normalized = normalizeHostname(entry.trim());

    if (normalized.startsWith('*.')) {
      return hostname.endsWith(normalized.slice(1));
    }

    return hostname === normalized;
  });

const assertPublicAddress = (rawAddress: string) => {
  const address = normalizeMappedIpv4(rawAddress);
  const normalizedFamily = isIP(address);
  const type = normalizedFamily === 4 ? 'ipv4' : 'ipv6';

  if (
    (normalizedFamily !== 4 && normalizedFamily !== 6)
    || blockedAddresses.check(address, type)
    || (
      normalizedFamily === 6
      && blockedUnnormalizedMappedAddresses.check(address, 'ipv6')
    )
  ) {
    throw new BrowserNetworkPolicyError(
      'Browser request resolved to a private, local, metadata, or reserved address'
    );
  }
};

const normalizeMappedIpv4 = (address: string) => {
  const words = parseIpv6Words(address);
  if (
    !words
    || words.slice(0, 5).some((word) => word !== 0)
    || words[5] !== 0xffff
  ) {
    return address;
  }

  const high = words[6]!;
  const low = words[7]!;
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
};

const parseIpv6Words = (value: string): number[] | null => {
  let normalized = value.toLowerCase().replace(/^\[|\]$/g, '');
  const dottedTail = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];

  if (dottedTail) {
    if (isIP(dottedTail) !== 4) {
      return null;
    }
    const octets = dottedTail.split('.').map(Number);
    normalized = normalized.slice(0, -dottedTail.length)
      + `${((octets[0]! << 8) | octets[1]!).toString(16)}:`
      + ((octets[2]! << 8) | octets[3]!).toString(16);
  }

  const halves = normalized.split('::');
  if (halves.length > 2) {
    return null;
  }
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  if (
    [...left, ...right].some((word) => !/^[0-9a-f]{1,4}$/.test(word))
    || (halves.length === 1 && left.length !== 8)
    || (halves.length === 2 && left.length + right.length >= 8)
  ) {
    return null;
  }

  const zeroCount = halves.length === 2 ? 8 - left.length - right.length : 0;
  return [
    ...left.map((word) => Number.parseInt(word, 16)),
    ...Array.from({ length: zeroCount }, () => 0),
    ...right.map((word) => Number.parseInt(word, 16))
  ];
};
