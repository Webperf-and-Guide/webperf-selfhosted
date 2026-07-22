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

const buildDispatchErrorMessage = (
  code: 'request_failed' | 'response_invalid',
  status: number | null
) => {
  if (code === 'response_invalid') {
    return 'Scheduler dispatch response was invalid';
  }

  if (status == null) {
    return 'Scheduler dispatch request failed';
  }

  return `Scheduler dispatch request failed with HTTP ${status}`;
};

export class SchedulerDispatchError extends Error {
  override readonly name = 'SchedulerDispatchError';

  constructor(
    readonly code: 'request_failed' | 'response_invalid',
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
    || requestTimeoutMs > 300_000
  ) {
    throw new Error('Scheduler request timeout must be an integer between 1 and 300000ms');
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
        throw signal.reason ?? error;
      }

      throw new SchedulerDispatchError('request_failed', null);
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new SchedulerDispatchError('request_failed', response.status);
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason ?? error;
      }

      if (timeoutController.signal.aborted) {
        throw new SchedulerDispatchError('request_failed', null);
      }

      throw new SchedulerDispatchError('response_invalid', response.status);
    }

    if (timeoutController.signal.aborted) {
      throw new SchedulerDispatchError('request_failed', null);
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
  maxBackoffMs = Math.max(pollIntervalMs, 15 * 60_000),
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
    || maxBackoffMs < pollIntervalMs
    || maxBackoffMs > 86_400_000
  ) {
    throw new Error('Scheduler maximum backoff must be an integer between the poll interval and 86400000ms');
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

export const describeSchedulerError = (error: unknown) => {
  if (error instanceof SchedulerDispatchError) {
    return {
      errorType: error.name,
      errorCode: error.code,
      status: error.status
    };
  }

  return {
    errorType: error instanceof Error
      ? error.name.replaceAll(/[^A-Za-z0-9_.:-]/g, '').slice(0, 120) || 'Error'
      : 'UnknownError'
  };
};

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
