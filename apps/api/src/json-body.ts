export class JsonBodyTooLargeError extends Error {
  override readonly name = 'JsonBodyTooLargeError';

  constructor(readonly maxBytes: number) {
    super(`JSON payload must not exceed ${maxBytes} bytes`);
  }
}

export class JsonBodyEmptyError extends Error {
  override readonly name = 'JsonBodyEmptyError';

  constructor() {
    super('JSON payload is required');
  }
}

const cancelBody = async (body: ReadableStream<Uint8Array> | null) => {
  try {
    await body?.cancel();
  } catch {
    // The connection may already be closed; the size error remains authoritative.
  }
};

export const readBoundedJson = async (
  request: Request,
  maxBytes: number
): Promise<unknown> => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('JSON body limit must be a positive integer');
  }

  const contentLengthValue = request.headers.get('content-length');
  if (contentLengthValue && /^\d+$/.test(contentLengthValue)) {
    const contentLength = Number(contentLengthValue);
    if (!Number.isSafeInteger(contentLength) || contentLength > maxBytes) {
      await cancelBody(request.body);
      throw new JsonBodyTooLargeError(maxBytes);
    }
  }

  if (!request.body) {
    throw new JsonBodyEmptyError();
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
        await cancelReader(reader);
        throw new JsonBodyTooLargeError(maxBytes);
      }

      if (byteSize > bytes.byteLength) {
        const nextCapacity = Math.min(
          maxBytes,
          Math.max(byteSize, Math.max(bytes.byteLength * 2, 1_024))
        );
        const nextBytes = new Uint8Array(nextCapacity);
        nextBytes.set(bytes);
        bytes = nextBytes;
      }
      bytes.set(value, byteSize - value.byteLength);
    }
  } finally {
    reader.releaseLock();
  }

  if (byteSize === 0) {
    throw new JsonBodyEmptyError();
  }

  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, byteSize))
  );
};

const cancelReader = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
  try {
    await reader.cancel();
  } catch {
    // The connection may already be closed; the size error remains authoritative.
  }
};
