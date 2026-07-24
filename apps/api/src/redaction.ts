import { redactedValue } from '@webperf/contracts';

export { redactedValue };
export const maxRedactedJsonResponseBytes = 5 * 1024 * 1024;
const maxRedactionDepth = 32;
const staleEntityHeaderNames = new Set([
  'content-encoding',
  'content-length',
  'content-md5',
  'content-range',
  'etag'
]);

const exactSensitiveHeaderNames = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
  'api-key'
]);
const compactSensitiveHeaderNames = new Set([
  'apikey',
  'apitoken',
  'accesskey',
  'accesstoken',
  'refreshkey',
  'refreshtoken',
  'authkey',
  'authtoken',
  'csrfkey',
  'csrftoken',
  'sessionkey',
  'sessiontoken',
  'bearerkey',
  'bearertoken',
  'clientsecret',
  'clientkey',
  'clienttoken',
  'privatekey',
  'signingkey',
  'encryptionkey'
]);
const sensitiveHeaderNameStems = [
  'token',
  'secret',
  'key',
  'password',
  'passwd',
  'credential',
  'bearer'
] as const;
const sensitiveHeaderNameStemPattern = new RegExp(
  `(?:^|[-_])(?:${sensitiveHeaderNameStems.join('|')})(?:$|[-_])`
);
const sensitiveHeaderNameStemSet = new Set<string>(sensitiveHeaderNameStems);
const sensitivePropertySegments = new Set([
  'authorization',
  'bearer',
  'credential',
  'credentials',
  'passwd',
  'password',
  'secret',
  'token'
]);
const sensitiveKeyQualifiers = new Set([
  'access',
  'api',
  'auth',
  'bearer',
  'client',
  'csrf',
  'encryption',
  'private',
  'secret',
  'session',
  'signing'
]);
const sensitiveKeyPayloadSegments = new Set([
  'bytes',
  'data',
  'material',
  'pair',
  'pem',
  'store',
  'value'
]);
const diagnosticCredentialNamePattern =
  '(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|credentials?|passwd|password|secret|token)';
const diagnosticCredentialValuePattern = `(?:"[^"]*"|'[^']*'|[^\\s"',;)}\\]|]+)`;
const diagnosticAssignmentPattern = new RegExp(
  `\\b((${diagnosticCredentialNamePattern})\\s*(?::|=|\\bis\\b)\\s*)${diagnosticCredentialValuePattern}`,
  'gi'
);
const diagnosticForCredentialPattern = new RegExp(
  `\\b(for\\s+${diagnosticCredentialNamePattern}\\s+)${diagnosticCredentialValuePattern}`,
  'gi'
);
const diagnosticBearerPattern = /\b(Bearer\s+)[^\s"',;)}\]|]+/gi;

export const isSensitiveHeaderName = (name: string) => {
  const normalized = name.trim().toLowerCase();
  const compact = normalized.replaceAll(/[-_]/g, '');
  return exactSensitiveHeaderNames.has(normalized)
    || sensitiveHeaderNameStemPattern.test(normalized)
    || compactSensitiveHeaderNames.has(compact)
    || (
      compact.startsWith('x')
      && (
        compactSensitiveHeaderNames.has(compact.slice(1))
        || sensitiveHeaderNameStemSet.has(compact.slice(1))
      )
    );
};

const propertyNameSegments = (name: string) => name
  .trim()
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter(Boolean);

const isSensitivePropertyName = (name: string) => {
  if (isSensitiveHeaderName(name)) {
    return true;
  }

  const segments = propertyNameSegments(name);
  if (segments.some((segment) => sensitivePropertySegments.has(segment))) {
    return true;
  }

  const keyIndex = segments.indexOf('key');
  return keyIndex === 0
    ? segments.length === 1 || sensitiveKeyPayloadSegments.has(segments[1]!)
    : keyIndex > 0 && sensitiveKeyQualifiers.has(segments[keyIndex - 1]!);
};

const isUrlPropertyName = (name: string) =>
  /url$/i.test(name) || /^(?:href|uri|endpoint|callback|redirect|webhook|target)$/i.test(name);

export const redactSensitiveData = (value: unknown, parentKey?: string): unknown =>
  redactSensitiveDataAtDepth(value, parentKey, 0, new WeakSet<object>());

const redactSensitiveDataAtDepth = (
  value: unknown,
  parentKey: string | undefined,
  depth: number,
  ancestors: WeakSet<object>
): unknown => {
  if (depth > maxRedactionDepth) {
    return redactedValue;
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      return redactedValue;
    }

    ancestors.add(value);
    try {
      return value.map((item) => redactSensitiveDataAtDepth(item, parentKey, depth + 1, ancestors));
    } finally {
      ancestors.delete(value);
    }
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (ancestors.has(value)) {
    return redactedValue;
  }

  const source = value as Record<string, unknown>;
  // JSON permits `__proto__` as an ordinary key. A null prototype prevents
  // bracket assignment from invoking Object.prototype.__proto__ and silently
  // dropping that key from the redacted response.
  const result: Record<string, unknown> = Object.create(null);
  const name = typeof source.name === 'string' ? source.name : null;
  const redactNamedValue = parentKey === 'cookies' || (name !== null && isSensitiveHeaderName(name));
  ancestors.add(value);

  try {
    for (const [key, item] of Object.entries(source)) {
      if (typeof item === 'string' && (key === 'error' || key === 'message')) {
        result[key] = redactDiagnosticText(item);
        continue;
      }

      if (isSensitivePropertyName(key)) {
        result[key] = redactedValue;
        continue;
      }

      if (key === 'value' && typeof item === 'string' && redactNamedValue) {
        result[key] = redactedValue;
        continue;
      }

      if (typeof item === 'string' && isUrlPropertyName(key)) {
        result[key] = redactUrlQuery(item);
        continue;
      }

      if (typeof item === 'string') {
        result[key] = redactUrlsInText(item);
        continue;
      }

      result[key] = redactSensitiveDataAtDepth(item, key, depth + 1, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }

  return result;
};

export const redactUrlsInText = (value: string) =>
  value.replace(/https?:\/\/[^\s"'<>,;)}\]|]+/gi, (candidate) => redactUrlQuery(candidate));

const redactDiagnosticText = (value: string) => {
  // Preserve safe operator context while replacing only values attached to a
  // credential cue; generic messages that merely mention a secret stay useful.
  return redactUrlsInText(value)
    .replace(diagnosticBearerPattern, `$1${redactedValue}`)
    .replace(diagnosticAssignmentPattern, `$1${redactedValue}`)
    .replace(diagnosticForCredentialPattern, `$1${redactedValue}`);
};

export const redactUrlQuery = (value: string) => {
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
    const withoutCredentials = redactMalformedUrlCredentials(value);
    const fragmentIndex = withoutCredentials.indexOf('#');
    const withoutFragment = fragmentIndex >= 0
      ? withoutCredentials.slice(0, fragmentIndex)
      : withoutCredentials;
    const queryIndex = withoutFragment.indexOf('?');
    return queryIndex >= 0 ? `${withoutFragment.slice(0, queryIndex)}?redacted` : withoutFragment;
  }
};

const redactMalformedUrlCredentials = (value: string) => {
  const scheme = /^https?:\/\//i.exec(value);
  if (!scheme) {
    return value;
  }

  const authorityStart = scheme[0].length;
  const authorityEnd = [
    value.indexOf('/', authorityStart),
    value.indexOf('?', authorityStart),
    value.indexOf('#', authorityStart)
  ].filter((index) => index >= 0)
    .reduce((minimum, index) => Math.min(minimum, index), value.length);
  const credentialEnd = value.lastIndexOf('@', authorityEnd - 1);
  if (credentialEnd < authorityStart) {
    return value;
  }

  return `${value.slice(0, authorityStart)}${redactedValue}${value.slice(credentialEnd)}`;
};

export const redactJsonResponse = async (response: Response) => {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';

  if (!contentType.includes('json')) {
    return response;
  }

  let body: string | null;
  try {
    body = await readBoundedResponseText(response, maxRedactedJsonResponseBytes);
  } catch {
    return safeRedactionFailureResponse(
      'Response body could not be read safely',
      response
    );
  }

  if (body === null) {
    return safeRedactionFailureResponse(
      'Response exceeded the safe redaction byte limit',
      response
    );
  }

  if (body.length === 0) {
    return rebuildResponse(null, response);
  }

  try {
    return rebuildResponse(JSON.stringify(redactSensitiveData(JSON.parse(body))), response);
  } catch {
    return safeRedactionFailureResponse('Response was not valid JSON', response);
  }
};

const readBoundedResponseText = async (response: Response, maxBytes: number) => {
  const contentLengthHeader = response.headers.get('content-length');
  const normalizedContentLength = contentLengthHeader?.trim() ?? '';
  if (/^(?:0|[1-9]\d*)$/.test(normalizedContentLength)) {
    const declaredBytes = Number(normalizedContentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
  }

  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
};

const safeRedactionFailureResponse = (message: string, response: Response) => {
  const headers = buildSafeResponseHeaders(response);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');

  return new Response(JSON.stringify({ error: message }), {
    status: 500,
    statusText: 'Internal Server Error',
    headers
  });
};

const rebuildResponse = (body: BodyInit | null, response: Response) => {
  const headers = buildSafeResponseHeaders(response);
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};

const buildSafeResponseHeaders = (response: Response) => {
  const headers = new Headers(response.headers);

  for (const name of [...headers.keys()]) {
    if (staleEntityHeaderNames.has(name) || isSensitiveHeaderName(name)) {
      headers.delete(name);
    }
  }

  return headers;
};
