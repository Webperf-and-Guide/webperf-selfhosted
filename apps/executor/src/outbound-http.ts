import { lookup } from 'node:dns/promises';
import {
  request as createHttpRequest,
  type IncomingHttpHeaders,
  type RequestOptions
} from 'node:http';
import { request as createHttpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';

export type OutboundAddressPolicy = 'public' | 'loopback' | 'trusted-private';
export type LookupAddress = { address: string; family: number };
export type LookupHost = (hostname: string) => Promise<LookupAddress[]>;

export type PinnedHttpRequestInit = {
  method: string;
  headers?: HeadersInit;
  body?: string;
  signal: AbortSignal;
  addressPolicy: OutboundAddressPolicy;
  discardResponseBody?: boolean;
  maximumResponseBytes?: number;
};

export type PinnedHttpRequest = (
  url: URL,
  init: PinnedHttpRequestInit
) => Promise<Response>;

export type ResolvedOutboundTarget = {
  url: URL;
  address: string;
  family: 4 | 6;
};

export class OutboundHttpPolicyError extends Error {
  override readonly name = 'OutboundHttpPolicyError';

  constructor(
    readonly code: 'invalid_target' | 'dns_failed' | 'address_blocked',
    message: string
  ) {
    super(message);
  }
}

const defaultDnsTimeoutMs = 10_000;
const defaultRequestTimeoutMs = 30_000;
const defaultMaximumResponseBytes = 1_048_576;
const blockedAddresses = new BlockList();
const trustedPrivateBlockedAddresses = new BlockList();

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

// Operator-trusted probe origins may use RFC 1918 container/LAN space, but
// they still cannot resolve to metadata, link-local, loopback, documentation,
// benchmarking, multicast, or otherwise reserved destinations.
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
] as const) {
  trustedPrivateBlockedAddresses.addSubnet(network, prefix, 'ipv4');
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


for (const [network, prefix] of [
  ['::', 96],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fe80::', 10],
  ['ff00::', 8]
] as const) {
  trustedPrivateBlockedAddresses.addSubnet(network, prefix, 'ipv6');
}

export const resolveOutboundHttpTarget = async (
  value: string | URL,
  {
    addressPolicy,
    lookupHost = defaultLookupHost,
    lookupTimeoutMs = defaultDnsTimeoutMs,
    signal
  }: {
    addressPolicy: OutboundAddressPolicy;
    lookupHost?: LookupHost;
    lookupTimeoutMs?: number;
    signal?: AbortSignal;
  }
): Promise<ResolvedOutboundTarget> => {
  let url: URL;

  try {
    url = value instanceof URL ? new URL(value) : new URL(value);
  } catch {
    throw new OutboundHttpPolicyError('invalid_target', 'Outbound HTTP target is invalid');
  }

  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
  ) {
    throw new OutboundHttpPolicyError('invalid_target', 'Outbound HTTP target is invalid');
  }

  const hostname = normalizeOutboundHostname(url.hostname);
  const literalFamily = isIP(hostname);

  if (literalFamily === 4 || literalFamily === 6) {
    assertAddressPolicy(hostname, addressPolicy);
    return { url, address: hostname, family: literalFamily };
  }

  if (
    addressPolicy !== 'trusted-private'
    && (
      hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname.endsWith('.local')
      || hostname.endsWith('.internal')
    )
    && !(addressPolicy === 'loopback' && hostname === 'localhost')
  ) {
    throw new OutboundHttpPolicyError('address_blocked', 'Outbound HTTP hostname is blocked');
  }

  let addresses: LookupAddress[];
  try {
    addresses = await lookupHostWithDeadline(
      hostname,
      lookupHost,
      lookupTimeoutMs,
      signal
    );
  } catch (error) {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
    }
    if (error instanceof OutboundHttpPolicyError) {
      throw error;
    }
    throw new OutboundHttpPolicyError('dns_failed', 'Outbound HTTP target could not be resolved');
  }

  if (addresses.length === 0) {
    throw new OutboundHttpPolicyError('dns_failed', 'Outbound HTTP target did not resolve');
  }

  const normalizedAddresses = addresses.map(({ address }) => {
    const normalizedAddress = normalizeOutboundHostname(address);
    const family = isIP(normalizedAddress);
    if (family !== 4 && family !== 6) {
      throw new OutboundHttpPolicyError(
        'dns_failed',
        'Outbound HTTP target returned an invalid address'
      );
    }
    assertAddressPolicy(normalizedAddress, addressPolicy);
    return { address: normalizedAddress, family: family as 4 | 6 };
  });
  const selectedAddress = normalizedAddresses[0];
  if (!selectedAddress) {
    throw new OutboundHttpPolicyError('dns_failed', 'Outbound HTTP target did not resolve');
  }

  return { url, ...selectedAddress };
};

export const createPinnedHttpRequest = ({
  lookupHost = defaultLookupHost,
  lookupTimeoutMs = defaultDnsTimeoutMs,
  requestTimeoutMs = defaultRequestTimeoutMs
}: {
  lookupHost?: LookupHost;
  lookupTimeoutMs?: number;
  requestTimeoutMs?: number;
} = {}): PinnedHttpRequest => async (url, init) => {
  if (
    !Number.isSafeInteger(requestTimeoutMs)
    || requestTimeoutMs < 1
    || requestTimeoutMs > 300_000
  ) {
    throw new Error('Outbound HTTP request timeout must be between 1 and 300000ms');
  }

  const target = await resolveOutboundHttpTarget(url, {
    addressPolicy: init.addressPolicy,
    lookupHost,
    lookupTimeoutMs,
    signal: init.signal
  });
  const maximumResponseBytes = init.maximumResponseBytes ?? defaultMaximumResponseBytes;

  if (
    !Number.isSafeInteger(maximumResponseBytes)
    || maximumResponseBytes < 0
    || maximumResponseBytes > 16_777_216
  ) {
    throw new Error('Maximum outbound response bytes must be between 0 and 16777216');
  }

  return issuePinnedRequest(target, init, maximumResponseBytes, requestTimeoutMs);
};

export const requestPinnedHttp = createPinnedHttpRequest();

const issuePinnedRequest = (
  target: ResolvedOutboundTarget,
  init: PinnedHttpRequestInit,
  maximumResponseBytes: number,
  requestTimeoutMs: number
) => new Promise<Response>((resolve, reject) => {
  const originalHostname = normalizeOutboundHostname(target.url.hostname);
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  headers.host = target.url.host;
  const options: RequestOptions = {
    protocol: target.url.protocol,
    hostname: target.address,
    family: target.family,
    port: Number(target.url.port || (target.url.protocol === 'https:' ? '443' : '80')),
    method: init.method,
    path: `${target.url.pathname}${target.url.search}`,
    headers,
    agent: false,
    signal: init.signal
  };
  const request = target.url.protocol === 'https:'
    ? createHttpsRequest({
        ...options,
        ...(isIP(originalHostname) === 0 ? { servername: originalHostname } : {}),
        checkServerIdentity: (_hostname, certificate) =>
          checkServerIdentity(originalHostname, certificate)
      }, handleResponse)
    : createHttpRequest(options, handleResponse);
  let settled = false;
  const timeout = setTimeout(() => {
    const timeoutError = Object.assign(new Error('Outbound HTTP request timed out'), {
      code: 'ETIMEDOUT'
    });
    request.destroy(timeoutError);
  }, requestTimeoutMs);
  timeout.unref?.();

  function settleResponse(response: Response) {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timeout);
    resolve(response);
  }

  function settleError(error: unknown) {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timeout);
    reject(error);
  }

  function handleResponse(incoming: import('node:http').IncomingMessage) {
    const responseInit = {
      status: incoming.statusCode ?? 502,
      statusText: incoming.statusMessage,
      headers: responseHeaders(incoming.headers)
    };

    if (init.discardResponseBody) {
      incoming.once('error', () => undefined);
      incoming.destroy();
      settleResponse(new Response(null, responseInit));
      return;
    }

    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;
    incoming.on('data', (chunk: Uint8Array) => {
      receivedBytes += chunk.byteLength;
      if (receivedBytes > maximumResponseBytes) {
        const sizeError = Object.assign(new Error('Outbound HTTP response exceeded its byte limit'), {
          code: 'ERR_RESPONSE_TOO_LARGE'
        });
        incoming.destroy(sizeError);
        settleError(sizeError);
        return;
      }
      chunks.push(chunk);
    });
    incoming.once('end', () => {
      const body = receivedBytes === 0 || [204, 205, 304].includes(responseInit.status)
        ? null
        : Buffer.concat(chunks);
      settleResponse(new Response(body, responseInit));
    });
    incoming.once('error', settleError);
  }

  request.once('error', settleError);
  request.end(init.body);
});

async function defaultLookupHost(hostname: string): Promise<LookupAddress[]> {
  return lookup(hostname, { all: true, verbatim: true }) as Promise<LookupAddress[]>;
}

const lookupHostWithDeadline = async (
  hostname: string,
  lookupHost: LookupHost,
  timeoutMs: number,
  signal?: AbortSignal
) => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error('Outbound DNS lookup timeout must be between 1 and 60000ms');
  }

  let timeout: ReturnType<typeof setTimeout> | null = null;
  let abortHandler: (() => void) | null = null;
  const abortPromise = signal
    ? new Promise<never>((_resolve, reject) => {
        abortHandler = () => reject(
          signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
        );
        if (signal.aborted) {
          abortHandler();
        } else {
          signal.addEventListener('abort', abortHandler, { once: true });
        }
      })
    : null;
  const lookupPromise = lookupHost(hostname);
  // Keep a rejection observer attached when timeout or abort wins the race.
  void lookupPromise.catch(() => undefined);

  try {
    return await Promise.race([
      lookupPromise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Outbound DNS lookup timed out')),
          timeoutMs
        );
        timeout.unref?.();
      }),
      ...(abortPromise ? [abortPromise] : [])
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (signal && abortHandler) {
      signal.removeEventListener('abort', abortHandler);
    }
  }
};

const assertAddressPolicy = (
  rawAddress: string,
  addressPolicy: OutboundAddressPolicy
) => {
  const address = normalizeMappedIpv4(rawAddress);
  const family = isIP(address);
  if (family !== 4 && family !== 6) {
    throw new OutboundHttpPolicyError('address_blocked', 'Outbound HTTP address is blocked');
  }

  if (addressPolicy === 'loopback') {
    if (!isLoopbackAddress(address)) {
      throw new OutboundHttpPolicyError('address_blocked', 'Outbound HTTP address is not loopback');
    }
    return;
  }

  const type = family === 4 ? 'ipv4' : 'ipv6';
  const blockList = addressPolicy === 'trusted-private'
    ? trustedPrivateBlockedAddresses
    : blockedAddresses;
  if (blockList.check(address, type)) {
    throw new OutboundHttpPolicyError(
      'address_blocked',
      'Outbound HTTP address is private, local, metadata, or reserved'
    );
  }
};

const isLoopbackAddress = (address: string) => {
  const family = isIP(address);
  if (family === 4) {
    return address.split('.')[0] === '127';
  }
  if (family === 6) {
    try {
      return new URL(`http://[${address}]/`).hostname === '[::1]';
    } catch {
      return false;
    }
  }
  return false;
};

const responseHeaders = (source: IncomingHttpHeaders) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) {
      continue;
    }
    for (const entry of Array.isArray(value) ? value : [value]) {
      headers.append(name, String(entry));
    }
  }
  return headers;
};

export const normalizeOutboundHostname = (hostname: string) =>
  hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();

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
  let normalized = normalizeOutboundHostname(value);
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
    left.some((part) => !/^[0-9a-f]{1,4}$/.test(part))
    || right.some((part) => !/^[0-9a-f]{1,4}$/.test(part))
  ) {
    return null;
  }
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    return null;
  }
  return [
    ...left.map((part) => Number.parseInt(part, 16)),
    ...Array.from({ length: Math.max(0, missing) }, () => 0),
    ...right.map((part) => Number.parseInt(part, 16))
  ];
};
