import type {
  ExecutionJob,
  ExecutionJobFailRequest,
  ExecutionJobLeaseRequest,
  ExecutionJobOwnerRequest
} from '@webperf/contracts';
import { executionJobSchema } from '@webperf/contracts';

export type ExecutorApiClient = {
  claim(input: ExecutionJobLeaseRequest): Promise<ExecutionJob | null>;
  start(id: string, input: ExecutionJobLeaseRequest): Promise<ExecutionJob>;
  renew(id: string, input: ExecutionJobLeaseRequest): Promise<ExecutionJob>;
  complete(id: string, input: ExecutionJobOwnerRequest): Promise<ExecutionJob>;
  fail(id: string, input: ExecutionJobFailRequest): Promise<ExecutionJob>;
};

export class ExecutorApiError extends Error {
  override readonly name: string = 'ExecutorApiError';

  constructor(
    message: string,
    readonly status: number | null
  ) {
    super(message);
  }
}

export const createExecutorApiClient = ({
  baseUrl,
  internalSecret,
  requestTimeoutMs = 30_000,
  fetchImpl = globalThis.fetch
}: {
  baseUrl: string;
  internalSecret: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof globalThis.fetch;
}): ExecutorApiClient => {
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 100 || requestTimeoutMs > 300_000) {
    throw new Error('Executor API timeout must be an integer between 100 and 300000ms');
  }

  const normalizedInternalSecret = internalSecret.trim();

  if (normalizedInternalSecret.length < 16) {
    throw new Error('Executor API internal secret must contain at least 16 characters');
  }

  const apiUrl = new URL(baseUrl);

  if (
    !['http:', 'https:'].includes(apiUrl.protocol)
    || apiUrl.username
    || apiUrl.password
    || apiUrl.pathname !== '/'
    || apiUrl.search
    || apiUrl.hash
  ) {
    throw new Error('Executor API base URL must be a credential-free HTTP(S) origin');
  }

  const request = async (
    path: string,
    body: ExecutionJobLeaseRequest | ExecutionJobOwnerRequest | ExecutionJobFailRequest,
    allowEmpty: boolean
  ) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetchImpl(new URL(path, apiUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${normalizedInternalSecret}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (allowEmpty && response.status === 204) {
        return null;
      }

      if (!response.ok) {
        throw new ExecutorApiError(
          `Executor API rejected the request with status ${response.status}`,
          response.status
        );
      }

      let payload: unknown;

      try {
        payload = await response.json();
      } catch {
        throw new ExecutorApiError('Executor API returned an invalid JSON response', response.status);
      }

      const parsed = executionJobSchema.safeParse(payload);

      if (!parsed.success) {
        throw new ExecutorApiError('Executor API returned an invalid execution job', response.status);
      }

      return parsed.data;
    } catch (error) {
      if (error instanceof ExecutorApiError) {
        throw error;
      }

      throw new ExecutorApiError(
        controller.signal.aborted
          ? 'Executor API request timed out'
          : 'Executor API request failed',
        null
      );
    } finally {
      clearTimeout(timeout);
    }
  };

  const mutate = async (
    id: string,
    action: 'start' | 'renew' | 'complete' | 'fail',
    body: ExecutionJobLeaseRequest | ExecutionJobOwnerRequest | ExecutionJobFailRequest
  ) => {
    const executionJob = await request(
      `/internal/execution-jobs/${encodeURIComponent(id)}/${action}`,
      body,
      false
    );

    if (!executionJob) {
      throw new ExecutorApiError('Executor API returned an empty mutation response', null);
    }

    return executionJob;
  };

  return {
    claim: (input) => request('/internal/execution-jobs/claim', input, true),
    start: (id, input) => mutate(id, 'start', input),
    renew: (id, input) => mutate(id, 'renew', input),
    complete: (id, input) => mutate(id, 'complete', input),
    fail: (id, input) => mutate(id, 'fail', input)
  };
};
