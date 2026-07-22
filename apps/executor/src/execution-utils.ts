import { ExecutionFailure } from './runner';

export const isRetryableHttpStatus = (status: number) =>
  status === 408 || status === 429 || status >= 500;

export const retryDelayMs = (attemptCount: number, random = Math.random) => {
  const exponent = Math.max(0, Math.min(16, attemptCount - 1));
  const baseDelayMs = Math.min(60_000, 1_000 * 2 ** exponent);
  const jitterMs = baseDelayMs * 0.1;
  return Math.min(
    60_000,
    Math.round(baseDelayMs - jitterMs + jitterMs * 2 * random())
  );
};

export const throwIfAborted = (signal: AbortSignal) => {
  if (!signal.aborted) {
    return;
  }

  throw signal.reason instanceof Error
    ? signal.reason
    : new ExecutionFailure('execution_aborted', 'Execution was aborted', true, 1_000);
};

export const redactExecutionText = (
  value: string,
  sensitiveValues: Array<string | null | undefined>
) => {
  let redacted = value;

  for (const sensitiveValue of sensitiveValues
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .sort((left, right) => right.length - left.length)) {
    redacted = redacted.replaceAll(sensitiveValue, '[REDACTED]');
  }

  return redacted.replace(/https?:\/\/[^\s"'<>]+/gi, redactUrlQuery);
};

const redactUrlQuery = (value: string) => {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = url.search ? '?redacted' : '';
    url.hash = '';
    return url.toString();
  } catch {
    return '[REDACTED_URL]';
  }
};
