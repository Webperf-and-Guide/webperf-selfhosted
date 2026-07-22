import type { BrowserAuditWorkerRequest } from '@webperf/contracts';

const redactedValue = '[REDACTED]';
const ascii = {
  at: '@'.charCodeAt(0),
  fragment: '#'.charCodeAt(0),
  path: '/'.charCodeAt(0),
  query: '?'.charCodeAt(0)
} as const;
// Keep this byte set aligned with the URL matcher in redactBrowserAuditText.
const urlDelimiters = new Set(Buffer.from(`\t\r\n "'<>`, 'ascii'));

export const redactBrowserAuditText = (value: string, input: BrowserAuditWorkerRequest) => {
  const redacted = redactKnownValues(value, input);

  return redacted.replace(/https?:\/\/[^\s"'<>]+/gi, redactUrlComponents);
};

export const redactBrowserAuditUrl = (value: string, input: BrowserAuditWorkerRequest) => {
  return redactUrlComponents(redactKnownValues(value, input));
};

const redactUrlComponents = (value: string) => {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    if (url.search.length > 0) {
      url.search = '?redacted';
    }
    url.hash = '';
    return url.toString();
  } catch {
    return value;
  }
};

export const redactBrowserAuditBytesInPlace = (
  payload: Uint8Array,
  input: BrowserAuditWorkerRequest
) => {
  // This Buffer must remain an alias of payload so a large trace can be
  // redacted without allocating another full-size artifact.
  const bytes = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);

  for (const sensitiveValue of getSensitiveValues(input)) {
    const sensitiveBytes = Buffer.from(sensitiveValue, 'utf8');
    let offset = 0;

    while (sensitiveBytes.length > 0) {
      const index = bytes.indexOf(sensitiveBytes, offset);

      if (index < 0) {
        break;
      }

      bytes.fill('*', index, index + sensitiveBytes.length);
      offset = index + sensitiveBytes.length;
    }
  }

  redactUrlSectionsInPlace(bytes);
  return payload;
};

const redactKnownValues = (value: string, input: BrowserAuditWorkerRequest) => {
  let redacted = value;

  for (const sensitiveValue of getSensitiveValues(input)) {
    redacted = redacted.replaceAll(sensitiveValue, redactedValue);
  }

  return redacted;
};

const getSensitiveValues = (input: BrowserAuditWorkerRequest) => [
  ...input.customHeaders.map((header) => header.value),
  ...input.cookies.map((cookie) => cookie.value),
  input.artifactUpload?.bearerToken
]
  .filter((candidate): candidate is string => Boolean(candidate))
  .sort((left, right) => right.length - left.length);

const redactUrlSectionsInPlace = (bytes: Buffer) => {
  for (let index = 0; index < bytes.length; index += 1) {
    if (!startsWithHttpScheme(bytes, index)) {
      continue;
    }

    const authorityStart = index + (startsWithAscii(bytes, index, 'https://') ? 8 : 7);
    let urlEnd = authorityStart;
    while (urlEnd < bytes.length && !isUrlDelimiter(bytes[urlEnd]!)) {
      urlEnd += 1;
    }

    let authorityEnd = urlEnd;
    for (let cursor = authorityStart; cursor < urlEnd; cursor += 1) {
      if (
        bytes[cursor] === ascii.path
        || bytes[cursor] === ascii.query
        || bytes[cursor] === ascii.fragment
      ) {
        authorityEnd = cursor;
        break;
      }
    }

    let atIndex = -1;
    for (let cursor = authorityStart; cursor < authorityEnd; cursor += 1) {
      if (bytes[cursor] === ascii.at) {
        atIndex = cursor;
      }
    }

    if (atIndex >= authorityStart) {
      bytes.fill('*', authorityStart, atIndex);
    }

    let queryStart = -1;
    let fragmentStart = -1;
    for (let cursor = authorityEnd; cursor < urlEnd; cursor += 1) {
      if (bytes[cursor] === ascii.fragment) {
        fragmentStart = cursor;
        break;
      }
      if (bytes[cursor] === ascii.query && queryStart < 0) {
        queryStart = cursor;
      }
    }

    if (queryStart >= 0) {
      const queryEnd = fragmentStart >= 0 ? fragmentStart : urlEnd;
      bytes.fill('*', queryStart + 1, queryEnd);
    }

    if (fragmentStart >= 0) {
      bytes.fill('*', fragmentStart + 1, urlEnd);
    }

    // The loop increment advances once more, to the first byte after this URL.
    index = urlEnd;
  }
};

const startsWithHttpScheme = (bytes: Buffer, index: number) =>
  startsWithAscii(bytes, index, 'http://') || startsWithAscii(bytes, index, 'https://');

const startsWithAscii = (bytes: Buffer, index: number, value: string) => {
  if (index + value.length > bytes.length) {
    return false;
  }

  for (let offset = 0; offset < value.length; offset += 1) {
    const actual = bytes[index + offset]!;
    const normalized = actual >= 65 && actual <= 90 ? actual + 32 : actual;

    if (normalized !== value.charCodeAt(offset)) {
      return false;
    }
  }

  return true;
};

const isUrlDelimiter = (value: number) => urlDelimiters.has(value);
