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

export class SchedulerDispatchError extends Error {
  override readonly name = 'SchedulerDispatchError';

  constructor(
    readonly code: 'request_failed' | 'response_invalid',
    readonly status: number | null
  ) {
    super(
      code === 'response_invalid'
        ? 'Scheduler dispatch response was invalid'
        : status == null
          ? 'Scheduler dispatch request failed'
          : `Scheduler dispatch request failed with HTTP ${status}`
    );
  }
}

export const dispatchScheduledChecks = async ({
  apiBaseUrl,
  internalSecret,
  signal,
  fetchImpl = globalThis.fetch
}: {
  apiBaseUrl: string;
  internalSecret: string;
  signal?: AbortSignal;
  fetchImpl?: SchedulerFetch;
}): Promise<SchedulerDispatchResult> => {
  const normalizedInternalSecret = internalSecret.trim();

  if (normalizedInternalSecret.length < 16) {
    throw new Error('Scheduler internal secret must contain at least 16 characters');
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
  let response: Response;

  try {
    response = await fetchImpl(dispatchUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${normalizedInternalSecret}`
      },
      cache: 'no-store',
      redirect: 'error',
      signal
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
  } catch {
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
};

export const runScheduler = async ({
  dispatch,
  pollIntervalMs,
  signal,
  logger,
  now = () => new Date()
}: {
  dispatch: (signal: AbortSignal) => Promise<SchedulerDispatchResult>;
  pollIntervalMs: number;
  signal: AbortSignal;
  logger: SchedulerLogger;
  now?: () => Date;
}) => {
  if (
    !Number.isSafeInteger(pollIntervalMs)
    || pollIntervalMs < 1
    || pollIntervalMs > 86_400_000
  ) {
    throw new Error('Scheduler poll interval must be an integer between 1 and 86400000ms');
  }

  while (!signal.aborted) {
    const startedAt = now().toISOString();

    try {
      const result = await dispatch(signal);

      if (signal.aborted) {
        break;
      }

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

      logger.error({
        event: 'dispatch_failed',
        startedAt,
        ...describeSchedulerError(error)
      });
    }

    await waitForNextPoll(pollIntervalMs, signal);
  }
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
