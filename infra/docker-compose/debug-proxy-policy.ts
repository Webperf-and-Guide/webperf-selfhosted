const hopByHopHeaders = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
] as const;

export const maximumDebugProxyRequestBytes = 8 * 1_024 * 1_024;

export class DebugProxyRequestBodyTooLargeError extends Error {
  override readonly name = 'DebugProxyRequestBodyTooLargeError';

  constructor(readonly maxBytes: number) {
    super(`Debug proxy request body must not exceed ${maxBytes} bytes`);
  }
}

export const resolveDebugProxyUpstream = (
  target: URL,
  requestUrl: URL
) => {
  const upstreamUrl = new URL(target);
  upstreamUrl.pathname = requestUrl.pathname;
  upstreamUrl.search = requestUrl.search;
  upstreamUrl.hash = '';
  return upstreamUrl;
};

export const stripHopByHopHeaders = (headers: Headers) => {
  const connectionHeaders = (headers.get('connection') ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

  for (const name of [...connectionHeaders, ...hopByHopHeaders]) {
    headers.delete(name);
  }
};

/**
 * Fully consumes a bounded body before the proxy opens an upstream request, so
 * an overflow cannot partially reach the internal service.
 */
export const readBoundedDebugProxyBody = async (
  request: Request,
  maxBytes = maximumDebugProxyRequestBytes
): Promise<Uint8Array | undefined> => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('Debug proxy request body limit must be a positive integer');
  }

  const contentLengthValue = request.headers.get('content-length');
  if (contentLengthValue && /^\d+$/.test(contentLengthValue)) {
    const contentLength = Number(contentLengthValue);
    if (!Number.isSafeInteger(contentLength) || contentLength > maxBytes) {
      await cancelBody(request.body);
      throw new DebugProxyRequestBodyTooLargeError(maxBytes);
    }
  }

  if (!request.body) {
    return undefined;
  }

  const reader = request.body.getReader();
  let bytes = new Uint8Array(Math.min(maxBytes, 8 * 1_024));
  let byteSize = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      byteSize += value.byteLength;
      if (byteSize > maxBytes) {
        throw new DebugProxyRequestBodyTooLargeError(maxBytes);
      }

      if (byteSize > bytes.byteLength) {
        const nextCapacity = Math.min(
          maxBytes,
          Math.max(byteSize, bytes.byteLength * 2)
        );
        const nextBytes = new Uint8Array(nextCapacity);
        nextBytes.set(bytes);
        bytes = nextBytes;
      }
      bytes.set(value, byteSize - value.byteLength);
    }
  } catch (error) {
    await cancelReader(reader);
    throw error;
  } finally {
    reader.releaseLock();
  }

  return bytes.subarray(0, byteSize);
};

const cancelBody = async (body: ReadableStream<Uint8Array> | null) => {
  try {
    await body?.cancel();
  } catch {
    // The client may already be gone; the byte-limit error remains authoritative.
  }
};

const cancelReader = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
  try {
    await reader.cancel();
  } catch {
    // The client may already be gone; the original read error remains authoritative.
  }
};
