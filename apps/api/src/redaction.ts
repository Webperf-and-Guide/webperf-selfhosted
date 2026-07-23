export const redactedValue = '[REDACTED]';
export const maxRedactedJsonResponseBytes = 5 * 1024 * 1024;
const maxRedactionDepth = 32;

const exactSensitiveHeaderNames = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
  'api-key'
]);

export const isSensitiveHeaderName = (name: string) => {
  const normalized = name.trim().toLowerCase();
  const compact = normalized.replaceAll(/[-_]/g, '');
  return exactSensitiveHeaderNames.has(normalized)
    || /(?:^|[-_])(token|secret|key|password|passwd|credential|bearer)(?:$|[-_])/.test(normalized)
    || /^(?:x)?(?:api(?:key|token)|access(?:key|token)|refresh(?:key|token)|auth(?:key|token)|csrf(?:key|token)|session(?:key|token)|bearer(?:key|token)|client(?:secret|key|token)|privatekey|signingkey|encryptionkey)$/.test(compact);
};

const isSensitivePropertyName = (name: string) =>
  /^(?:(?:client|webhook|upload|artifact|auth|bearer|access|refresh)[-_]?)?(?:secret|token|password|passwd|credentials?)$/i
    .test(name)
  || /^(?:api|secret|private|signing|encryption)[-_]?key$/i.test(name);

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
  const result: Record<string, unknown> = {};
  const name = typeof source.name === 'string' ? source.name : null;
  const redactNamedValue = parentKey === 'cookies' || (name !== null && isSensitiveHeaderName(name));
  ancestors.add(value);

  try {
    for (const [key, item] of Object.entries(source)) {
      if (typeof item === 'string' && (key === 'error' || key === 'message')) {
        result[key] = redactUrlsInText(item);
        continue;
      }

      if (typeof item === 'string' && isSensitivePropertyName(key)) {
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

      result[key] = redactSensitiveDataAtDepth(item, key, depth + 1, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }

  return result;
};

export const redactUrlsInText = (value: string) =>
  value.replace(/https?:\/\/[^\s"'<>,;)}\]|]+/gi, (candidate) => redactUrlQuery(candidate));

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
    const fragmentIndex = value.indexOf('#');
    const withoutFragment = fragmentIndex >= 0 ? value.slice(0, fragmentIndex) : value;
    const queryIndex = withoutFragment.indexOf('?');
    return queryIndex >= 0 ? `${withoutFragment.slice(0, queryIndex)}?redacted` : withoutFragment;
  }
};

export const redactJsonResponse = async (response: Response) => {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';

  if (!contentType.includes('json')) {
    return response;
  }

  const body = await readBoundedResponseText(response, maxRedactedJsonResponseBytes);

  if (body === null) {
    return safeRedactionFailureResponse('Response exceeded the safe redaction byte limit');
  }

  if (body.length === 0) {
    return rebuildResponse(null, response);
  }

  try {
    return rebuildResponse(JSON.stringify(redactSensitiveData(JSON.parse(body))), response);
  } catch {
    return safeRedactionFailureResponse('Response was not valid JSON');
  }
};

const readBoundedResponseText = async (response: Response, maxBytes: number) => {
  const declaredBytes = Number(response.headers.get('content-length'));

  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    await response.body?.cancel().catch(() => {});
    return null;
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

const safeRedactionFailureResponse = (message: string) =>
  new Response(JSON.stringify({ error: message }), {
    status: 500,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });

const rebuildResponse = (body: BodyInit | null, response: Response) => {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};
