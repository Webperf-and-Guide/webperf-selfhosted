import type { BrowserAuditWorkerRequest } from '@webperf/contracts';

const redactedValue = '[REDACTED]';

export const redactBrowserAuditText = (value: string, input: BrowserAuditWorkerRequest) => {
  const redacted = redactKnownValues(value, input);

  return redacted.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => redactBrowserAuditUrl(candidate, input));
};

export const redactBrowserAuditUrl = (value: string, input: BrowserAuditWorkerRequest) => {
  const redacted = redactKnownValues(value, input);

  try {
    const url = new URL(redacted);
    url.username = '';
    url.password = '';
    if (url.search.length > 0) {
      url.search = '?redacted';
    }
    url.hash = '';
    return url.toString();
  } catch {
    return redacted;
  }
};

export const redactBrowserAuditBytes = (payload: Uint8Array, input: BrowserAuditWorkerRequest) => {
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
      if (bytes[cursor] === 47 || bytes[cursor] === 63 || bytes[cursor] === 35) {
        authorityEnd = cursor;
        break;
      }
    }

    let atIndex = -1;
    for (let cursor = authorityStart; cursor < authorityEnd; cursor += 1) {
      if (bytes[cursor] === 64) {
        atIndex = cursor;
      }
    }

    if (atIndex >= authorityStart) {
      bytes.fill('*', authorityStart, atIndex);
    }

    let queryStart = -1;
    let fragmentStart = -1;
    for (let cursor = authorityEnd; cursor < urlEnd; cursor += 1) {
      if (bytes[cursor] === 35) {
        fragmentStart = cursor;
        break;
      }
      if (bytes[cursor] === 63 && queryStart < 0) {
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

const isUrlDelimiter = (value: number) =>
  value === 9 || value === 10 || value === 13 || value === 32 || value === 34 || value === 39 || value === 60 || value === 62;
