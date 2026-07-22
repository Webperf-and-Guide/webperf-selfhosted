export const redactedValue = '[REDACTED]';

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
  return exactSensitiveHeaderNames.has(normalized) || /(?:^|[-_])(token|secret|key)(?:$|[-_])/.test(normalized);
};

export const redactSensitiveData = (value: unknown, parentKey?: string): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item, parentKey));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  const name = typeof source.name === 'string' ? source.name : null;
  const redactNamedValue = parentKey === 'cookies' || (name !== null && isSensitiveHeaderName(name));

  for (const [key, item] of Object.entries(source)) {
    if (typeof item === 'string' && (key === 'error' || key === 'message')) {
      result[key] = redactUrlsInText(item);
      continue;
    }

    if (key === 'secret' && typeof item === 'string') {
      result[key] = redactedValue;
      continue;
    }

    if (key === 'value' && typeof item === 'string' && redactNamedValue) {
      result[key] = redactedValue;
      continue;
    }

    if (typeof item === 'string' && /url$/i.test(key)) {
      result[key] = redactUrlQuery(item);
      continue;
    }

    result[key] = redactSensitiveData(item, key);
  }

  return result;
};

export const redactUrlsInText = (value: string) =>
  value.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => redactUrlQuery(candidate));

export const redactSecretValues = (value: string, secrets: Array<string | null | undefined>) => {
  let redacted = value;

  for (const secret of secrets.filter((item): item is string => Boolean(item)).sort((a, b) => b.length - a.length)) {
    redacted = redacted.replaceAll(secret, redactedValue);
  }

  return redactUrlsInText(redacted);
};

export const redactUrlQuery = (value: string) => {
  try {
    const url = new URL(value);

    if (url.search.length > 0) {
      url.search = '?redacted';
    }
    url.hash = '';
    return url.toString();
  } catch {
    return value;
  }
};

export const redactJsonResponse = async (response: Response) => {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';

  if (!contentType.includes('json')) {
    return response;
  }

  const body = await response.text();

  if (body.length === 0) {
    return new Response(null, response);
  }

  try {
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    return new Response(JSON.stringify(redactSensitiveData(JSON.parse(body))), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  } catch {
    return new Response(body, response);
  }
};
