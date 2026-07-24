import {
  schedulerDispatchResponseSchema,
  type SchedulerDispatchResponse
} from '@webperf/contracts';

export type SchedulerFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export type SchedulerLogger = {
  info(event: Record<string, unknown>): void;
  error(event: Record<string, unknown>): void;
};

export type SchedulerDispatchResult = {
  payload: SchedulerDispatchResponse;
  createdJobCount: number;
};

export const defaultSchedulerRequestTimeoutMs = 30_000;
export const maxSchedulerRequestTimeoutMs = 5 * 60_000;
export const maxSchedulerBackoffMs = 2 * 86_400_000;
const minimumSchedulerBackoffCeilingMs = 15 * 60_000;

export type SchedulerDispatchErrorCode =
  | 'request_failed'
  | 'request_timeout'
  | 'response_invalid';

const buildDispatchErrorMessage = (
  code: SchedulerDispatchErrorCode,
  status: number | null
) => {
  if (code === 'request_timeout') {
    if (status === null) {
      return 'Scheduler dispatch request timed out';
    }

    return `Scheduler dispatch response timed out with HTTP ${status}`;
  }

  if (code === 'response_invalid') {
    return 'Scheduler dispatch response was invalid';
  }

  if (status === null) {
    return 'Scheduler dispatch request failed';
  }

  return `Scheduler dispatch request failed with HTTP ${status}`;
};

export class SchedulerDispatchError extends Error {
  override readonly name = 'SchedulerDispatchError';

  constructor(
    readonly code: SchedulerDispatchErrorCode,
    readonly status: number | null
  ) {
    super(buildDispatchErrorMessage(code, status));
  }
}

export const dispatchScheduledChecks = async ({
  apiBaseUrl,
  internalSecret,
  signal,
  requestTimeoutMs = defaultSchedulerRequestTimeoutMs,
  fetchImpl = globalThis.fetch
}: {
  apiBaseUrl: string;
  internalSecret: string;
  signal?: AbortSignal;
  requestTimeoutMs?: number;
  fetchImpl?: SchedulerFetch;
}): Promise<SchedulerDispatchResult> => {
  const normalizedInternalSecret = internalSecret.trim();

  if (normalizedInternalSecret.length < 16) {
    throw new Error('Scheduler internal secret must contain at least 16 characters');
  }

  if (
    !Number.isSafeInteger(requestTimeoutMs)
    || requestTimeoutMs < 1
    || requestTimeoutMs > maxSchedulerRequestTimeoutMs
  ) {
    throw new Error(
      `Scheduler request timeout must be an integer between 1 and ${maxSchedulerRequestTimeoutMs}ms`
    );
  }

  let apiUrl: URL;

  try {
    apiUrl = new URL(apiBaseUrl);
  } catch {
    throw new Error('Scheduler API base URL is invalid');
  }

  if (
    !['http:', 'https:'].includes(apiUrl.protocol)
    || apiUrl.username
    || apiUrl.password
    || apiUrl.pathname !== '/'
    || apiUrl.search
    || apiUrl.hash
  ) {
    throw new Error('Scheduler API base URL must be a credential-free HTTP(S) origin');
  }

  const dispatchUrl = new URL('/v1/scheduler/dispatch', apiUrl);
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), requestTimeoutMs);
  const requestSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  try {
    let response: Response;

    try {
      response = await fetchImpl(dispatchUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${normalizedInternalSecret}`
        },
        cache: 'no-store',
        redirect: 'error',
        signal: requestSignal
      });
    } catch (error) {
      if (signal?.aborted) {
        throw normalizeSchedulerAbortError(signal, error);
      }

      if (timeoutController.signal.aborted) {
        throw new SchedulerDispatchError('request_timeout', null);
      }

      throw new SchedulerDispatchError('request_failed', null);
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new SchedulerDispatchError('request_failed', response.status);
    }

    let payload: unknown;

    try {
      payload = await raceWithAbort(response.json(), requestSignal);
    } catch (error) {
      if (signal?.aborted) {
        throw normalizeSchedulerAbortError(signal, error);
      }

      if (timeoutController.signal.aborted) {
        throw new SchedulerDispatchError('request_timeout', response.status);
      }

      throw new SchedulerDispatchError('response_invalid', response.status);
    }

    const parsed = schedulerDispatchResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new SchedulerDispatchError('response_invalid', response.status);
    }

    return {
      payload: parsed.data,
      createdJobCount: parsed.data.triggeredProfiles.reduce(
        (count, profile) => count + profile.jobIds.length,
        0
      )
    };
  } finally {
    clearTimeout(timeout);
  }
};

export const runScheduler = async ({
  dispatch,
  pollIntervalMs,
  signal,
  logger,
  now = () => new Date(),
  maxBackoffMs = calculateDefaultSchedulerMaxBackoffMs(pollIntervalMs),
  wait = waitForNextPoll
}: {
  dispatch: (signal: AbortSignal) => Promise<SchedulerDispatchResult>;
  pollIntervalMs: number;
  signal: AbortSignal;
  logger: SchedulerLogger;
  now?: () => Date;
  maxBackoffMs?: number;
  wait?: (durationMs: number, signal: AbortSignal) => Promise<void>;
}) => {
  if (
    !Number.isSafeInteger(pollIntervalMs)
    || pollIntervalMs < 1
    || pollIntervalMs > 86_400_000
  ) {
    throw new Error('Scheduler poll interval must be an integer between 1 and 86400000ms');
  }

  if (
    !Number.isSafeInteger(maxBackoffMs)
    || maxBackoffMs <= pollIntervalMs
    || maxBackoffMs > maxSchedulerBackoffMs
  ) {
    throw new Error(
      `Scheduler maximum backoff must be an integer greater than the poll interval and no more than ${maxSchedulerBackoffMs}ms`
    );
  }

  let consecutiveFailures = 0;

  while (!signal.aborted) {
    const startedAt = now().toISOString();

    try {
      const result = await dispatch(signal);

      if (signal.aborted) {
        break;
      }

      consecutiveFailures = 0;

      logger.info({
        event: 'dispatch_succeeded',
        startedAt,
        dispatchedAt: result.payload.dispatchedAt,
        triggeredCount: result.payload.triggeredCount,
        createdJobCount: result.createdJobCount
      });
    } catch (error) {
      if (signal.aborted) {
        break;
      }

      consecutiveFailures += 1;

      logger.error({
        event: 'dispatch_failed',
        startedAt,
        ...describeSchedulerError(error)
      });
    }

    await wait(
      calculateSchedulerPollDelay(pollIntervalMs, consecutiveFailures, maxBackoffMs),
      signal
    );
  }
};

export const calculateSchedulerPollDelay = (
  pollIntervalMs: number,
  consecutiveFailures: number,
  maxBackoffMs: number
) => {
  if (consecutiveFailures < 1) {
    return pollIntervalMs;
  }

  const maximumExponent = Math.ceil(Math.log2(maxBackoffMs / pollIntervalMs));
  const exponent = Math.min(consecutiveFailures, maximumExponent);
  return Math.min(maxBackoffMs, pollIntervalMs * 2 ** exponent);
};

const calculateDefaultSchedulerMaxBackoffMs = (pollIntervalMs: number) =>
  Math.min(
    maxSchedulerBackoffMs,
    Math.max(minimumSchedulerBackoffCeilingMs, pollIntervalMs * 2)
  );

export const describeSchedulerError = (error: unknown) => {
  if (error instanceof SchedulerDispatchError) {
    return {
      errorType: error.name,
      errorCode: error.code,
      status: error.status
    };
  }

  const systemCode = (error as { code?: unknown } | null)?.code;
  const errorMessage = error instanceof Error
    ? sanitizeSchedulerErrorMessage(error.message)
    : null;
  return {
    errorType: error instanceof Error
      ? error.name.replaceAll(/[^A-Za-z0-9_.:-]/g, '').slice(0, 120) || 'Error'
      : 'UnknownError',
    ...(typeof systemCode === 'string' && /^[A-Z0-9_]{1,64}$/.test(systemCode)
      ? { systemCode }
      : {}),
    ...(errorMessage ? { errorMessage } : {})
  };
};

const sanitizeSchedulerErrorMessage = (value: string) => value
  .replaceAll(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, '[REDACTED]')
  .replaceAll(/https?:\/\/[^\s,;]+/gi, '[URL]')
  .replaceAll(/[A-Za-z0-9+/_=-]{16,}/g, '[REDACTED]')
  .replaceAll(/[^\x20-\x7E]/g, '')
  .trim()
  .slice(0, 200);

const waitForNextPoll = (durationMs: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, durationMs);
    const onAbort = () => {
      clearTimeout(timeout);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

const raceWithAbort = async <Result>(operation: Promise<Result>, signal: AbortSignal) => {
  if (signal.aborted) {
    throw normalizeSchedulerAbortError(signal);
  }

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(normalizeSchedulerAbortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  // Keep an explicit rejection observer when abort wins the race and the body
  // operation settles later after its stream has been interrupted.
  void operation.catch(() => undefined);

  try {
    return await Promise.race([operation, aborted]);
  } finally {
    if (onAbort) {
      signal.removeEventListener('abort', onAbort);
    }
  }
};

const normalizeSchedulerAbortError = (
  signal: AbortSignal,
  fallback?: unknown
): Error => {
  if (signal.reason instanceof Error) {
    return signal.reason;
  }
  if (fallback instanceof Error) {
    return fallback;
  }

  return Object.assign(new Error('Scheduler operation was aborted'), {
    name: 'AbortError'
  });
};
