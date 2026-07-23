import type { BrowserAuditWorkerRequest } from '@webperf/contracts';

const redactedValue = '[REDACTED]';
const broadRedactionMinimumLength = 8;
const ascii = {
  at: '@'.charCodeAt(0),
  fragment: '#'.charCodeAt(0),
  path: '/'.charCodeAt(0),
  query: '?'.charCodeAt(0)
} as const;
const urlDelimiters = new Set(Buffer.from("\t\r\n \"'<>`", 'ascii'));
const adjacentUrlDelimiters = new Set(Buffer.from(',;)]}|', 'ascii'));
const contextualValueDelimiters = new Set(
  Buffer.from("\t\r\n \"'`,;}])<>|", 'ascii')
);

export const redactBrowserAuditText = (value: string, input: BrowserAuditWorkerRequest) => {
  const redacted = redactKnownValues(value, input);

  return redacted.replace(/https?:\/\/[^\s"'<>`]+/gi, redactUrlSequence);
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
    return redactMalformedUrl(value);
  }
};

export const redactBrowserAuditBytesInPlace = (
  payload: Uint8Array,
  input: BrowserAuditWorkerRequest
) => {
  // This Buffer must remain an alias of payload so a large trace can be
  // redacted without allocating another full-size artifact.
  const bytes = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);

  for (const sensitiveValue of getBroadSensitiveValues(input)) {
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

  redactQuotedShortValuesInPlace(bytes, getShortSensitiveValues(input));
  redactShortContextsInPlace(bytes, getShortSensitivePairs(input));

  redactUrlSectionsInPlace(bytes);
  return payload;
};

const redactKnownValues = (value: string, input: BrowserAuditWorkerRequest) => {
  let redacted = value;

  for (const sensitiveValue of getBroadSensitiveValues(input)) {
    redacted = redacted.replaceAll(sensitiveValue, redactedValue);
  }

  redacted = redactQuotedShortValues(redacted, getShortSensitiveValues(input));
  return redactShortContexts(redacted, getShortSensitivePairs(input));
};

const getSensitiveValues = (input: BrowserAuditWorkerRequest) => [...new Set([
  ...input.customHeaders.map((header) => header.value),
  ...input.cookies.map((cookie) => cookie.value),
  input.artifactUpload?.bearerToken
].filter((candidate): candidate is string => Boolean(candidate)))];

const getBroadSensitiveValues = (input: BrowserAuditWorkerRequest) =>
  getSensitiveValues(input)
    .filter((candidate) => candidate.length >= broadRedactionMinimumLength)
    .sort((left, right) => right.length - left.length);

const getShortSensitiveValues = (input: BrowserAuditWorkerRequest) =>
  getSensitiveValues(input).filter(
    (candidate) => candidate.length < broadRedactionMinimumLength
  );

type SensitivePair = { name: string; value: string };

const getShortSensitivePairs = (input: BrowserAuditWorkerRequest): SensitivePair[] => [
  ...input.customHeaders,
  ...input.cookies
].filter(
  (candidate) => candidate.value.length > 0
    && candidate.value.length < broadRedactionMinimumLength
);

const redactMalformedUrl = (value: string) => {
  const withoutCredentials = value.replace(
    /^(https?:\/\/)[^/@\s]+@/i,
    `$1${redactedValue}@`
  );
  const queryIndex = withoutCredentials.indexOf('?');
  const fragmentIndex = withoutCredentials.indexOf('#');

  if (queryIndex >= 0) {
    return `${withoutCredentials.slice(0, queryIndex)}?redacted`;
  }
  if (fragmentIndex >= 0) {
    return withoutCredentials.slice(0, fragmentIndex);
  }
  return withoutCredentials;
};

const redactUrlSequence = (value: string) => value
  .split(/([,;|)\]}])(?=https?:\/\/)/i)
  .map((part) => /^https?:\/\//i.test(part) ? redactUrlComponents(part) : part)
  .join('');

const redactQuotedShortValues = (value: string, sensitiveValues: string[]) => {
  if (sensitiveValues.length === 0) {
    return value;
  }

  const sensitive = new Set(sensitiveValues);
  let redacted = '';
  let copyStart = 0;

  for (let index = 0; index < value.length; index += 1) {
    const quote = value[index];
    if (quote !== '"' && quote !== "'") {
      continue;
    }

    const closingQuote = findClosingQuote(value, index, quote);
    if (closingQuote < 0) {
      break;
    }
    if (sensitive.has(value.slice(index + 1, closingQuote))) {
      redacted += `${value.slice(copyStart, index + 1)}${redactedValue}`;
      copyStart = closingQuote;
    }
    index = closingQuote;
  }

  return `${redacted}${value.slice(copyStart)}`;
};

const findClosingQuote = (value: string, openingQuote: number, quote: string) => {
  let escaped = false;

  for (let index = openingQuote + 1; index < value.length; index += 1) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (value[index] === '\\') {
      escaped = true;
      continue;
    }
    if (value[index] === quote) {
      return index;
    }
  }

  return -1;
};

const redactShortContexts = (value: string, pairs: SensitivePair[]) => {
  let redacted = value;

  for (const pair of pairs) {
    const pattern = new RegExp(
      `(^|[^A-Za-z0-9_.-])(${escapeRegExp(pair.name)}\\s*[:=]\\s*)${escapeRegExp(pair.value)}(?![A-Za-z0-9_.-])`,
      'gim'
    );
    redacted = redacted.replace(pattern, `$1$2${redactedValue}`);
  }

  return redacted;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const redactQuotedShortValuesInPlace = (
  bytes: Buffer,
  sensitiveValues: string[]
) => {
  const sensitiveBuffers = sensitiveValues.map((value) => Buffer.from(value, 'utf8'));

  for (let index = 0; index < bytes.length; index += 1) {
    const quote = bytes[index];
    if (quote !== 34 && quote !== 39) {
      continue;
    }

    const closingQuote = findClosingQuoteInBytes(bytes, index, quote);
    if (closingQuote < 0) {
      break;
    }
    const valueLength = closingQuote - index - 1;
    const matches = sensitiveBuffers.some(
      (candidate) => candidate.byteLength === valueLength
        && bytes.subarray(index + 1, closingQuote).equals(candidate)
    );
    if (matches) {
      bytes.fill('*', index + 1, closingQuote);
    }
    index = closingQuote;
  }
};

const findClosingQuoteInBytes = (bytes: Buffer, openingQuote: number, quote: number) => {
  let escaped = false;

  for (let index = openingQuote + 1; index < bytes.length; index += 1) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (bytes[index] === 92) {
      escaped = true;
      continue;
    }
    if (bytes[index] === quote) {
      return index;
    }
  }

  return -1;
};

const redactShortContextsInPlace = (bytes: Buffer, pairs: SensitivePair[]) => {
  const patterns = pairs.map(({ name, value }) => ({
    name: Buffer.from(name, 'utf8'),
    value: Buffer.from(value, 'utf8')
  }));
  const patternsByFirstByte = new Map<number, typeof patterns>();

  for (const pattern of patterns) {
    const firstByte = normalizeAsciiByte(pattern.name[0]!);
    const current = patternsByFirstByte.get(firstByte) ?? [];
    current.push(pattern);
    patternsByFirstByte.set(firstByte, current);
  }

  for (let index = 0; index < bytes.length; index += 1) {
    if (index > 0 && isIdentifierByte(bytes[index - 1]!)) {
      continue;
    }
    const candidates = patternsByFirstByte.get(normalizeAsciiByte(bytes[index]!)) ?? [];

    for (const { name, value } of candidates) {
      if (!startsWithBufferCaseInsensitive(bytes, index, name)) {
        continue;
      }
      let separator = index + name.byteLength;
      while (separator < bytes.length && isAsciiWhitespace(bytes[separator]!)) {
        separator += 1;
      }
      if (bytes[separator] !== 58 && bytes[separator] !== 61) {
        continue;
      }
      let valueStart = separator + 1;
      while (valueStart < bytes.length && isAsciiWhitespace(bytes[valueStart]!)) {
        valueStart += 1;
      }
      const valueEnd = valueStart + value.byteLength;
      if (
        startsWithBuffer(bytes, valueStart, value)
        && (valueEnd === bytes.length || contextualValueDelimiters.has(bytes[valueEnd]!))
      ) {
        bytes.fill('*', valueStart, valueEnd);
        index = valueEnd - 1;
        break;
      }
    }
  }
};

const startsWithBuffer = (bytes: Buffer, index: number, value: Buffer) => {
  if (index + value.byteLength > bytes.length) {
    return false;
  }
  return bytes.subarray(index, index + value.byteLength).equals(value);
};

const startsWithBufferCaseInsensitive = (
  bytes: Buffer,
  index: number,
  value: Buffer
) => {
  if (index + value.byteLength > bytes.length) {
    return false;
  }
  for (let offset = 0; offset < value.byteLength; offset += 1) {
    if (normalizeAsciiByte(bytes[index + offset]!) !== normalizeAsciiByte(value[offset]!)) {
      return false;
    }
  }
  return true;
};

const normalizeAsciiByte = (value: number) =>
  value >= 65 && value <= 90 ? value + 32 : value;

const isIdentifierByte = (value: number) =>
  (value >= 48 && value <= 57)
  || (value >= 65 && value <= 90)
  || (value >= 97 && value <= 122)
  || value === 45
  || value === 46
  || value === 95;

const isAsciiWhitespace = (value: number) =>
  value === 9 || value === 10 || value === 13 || value === 32;

const redactUrlSectionsInPlace = (bytes: Buffer) => {
  for (let index = 0; index < bytes.length; index += 1) {
    if (!startsWithHttpScheme(bytes, index)) {
      continue;
    }

    const authorityStart = index + (startsWithAscii(bytes, index, 'https://') ? 8 : 7);
    let urlEnd = authorityStart;
    while (urlEnd < bytes.length && !isUrlDelimiter(bytes, urlEnd)) {
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

const isUrlDelimiter = (bytes: Buffer, index: number) =>
  urlDelimiters.has(bytes[index]!)
  || (
    adjacentUrlDelimiters.has(bytes[index]!)
    && startsWithHttpScheme(bytes, index + 1)
  );
