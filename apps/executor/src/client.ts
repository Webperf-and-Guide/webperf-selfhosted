import type {
  BrowserAuditArtifactUploadConfig,
  ExecutionFollowupsRequest,
  ExecutionFollowupsResponse,
  ExecutionJob,
  ExecutionJobFailRequest,
  ExecutionJobLeaseRequest,
  ExecutionJobOwnerRequest,
  ExecutionResourceContext,
  ExecutionResourceResultRequest
} from '@webperf/contracts';
import {
  browserAuditArtifactUploadGrantSchema,
  executionFollowupsResponseSchema,
  executionJobSchema,
  executionResourceContextSchema
} from '@webperf/contracts';

export type ExecutorLeaseClient = {
  claim(input: ExecutionJobLeaseRequest): Promise<ExecutionJob | null>;
  start(id: string, input: ExecutionJobLeaseRequest): Promise<ExecutionJob>;
  renew(id: string, input: ExecutionJobLeaseRequest): Promise<ExecutionJob>;
  complete(id: string, input: ExecutionJobOwnerRequest): Promise<ExecutionJob>;
  fail(id: string, input: ExecutionJobFailRequest): Promise<ExecutionJob>;
};

export type ExecutorApiClient = ExecutorLeaseClient & {
  context(id: string, input: ExecutionJobOwnerRequest): Promise<ExecutionResourceContext>;
  saveResult(id: string, input: ExecutionResourceResultRequest): Promise<void>;
  enqueueFollowups(id: string, input: ExecutionFollowupsRequest): Promise<ExecutionFollowupsResponse>;
};

export type BrowserAuditExecutorApiClient = ExecutorApiClient & {
  artifactUploadGrant(
    id: string,
    input: ExecutionJobOwnerRequest
  ): Promise<BrowserAuditArtifactUploadConfig>;
};

type ResponseSchema<T> = {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: unknown };
};

export class ExecutorApiError extends Error {
  override readonly name: string = 'ExecutorApiError';

  constructor(
    message: string,
    readonly status: number | null,
    options?: { cause?: unknown }
  ) {
    super(message, options);
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
}): BrowserAuditExecutorApiClient => {
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 100 || requestTimeoutMs > 300_000) {
    throw new Error('Executor API timeout must be an integer between 100 and 300000ms');
  }

  const normalizedInternalSecret = internalSecret.trim();

  if (normalizedInternalSecret.length < 16) {
    throw new Error('Executor API internal secret must contain at least 16 characters');
  }

  let apiUrl: URL;

  try {
    apiUrl = new URL(baseUrl);
  } catch (cause) {
    throw new Error('Executor API base URL is invalid', { cause });
  }

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

  const request = async <T>(
    path: string,
    body: unknown,
    schema: ResponseSchema<T> | null,
    allowEmpty: boolean
  ): Promise<T | null> => {
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
        await response.body?.cancel().catch(() => {});
        throw new ExecutorApiError(
          `Executor API rejected the request with status ${response.status}`,
          response.status
        );
      }

      if (!schema) {
        throw new ExecutorApiError('Executor API returned an unexpected response body', response.status);
      }

      let payload: unknown;

      try {
        payload = await response.json();
      } catch (cause) {
        throw new ExecutorApiError(
          'Executor API returned an invalid JSON response',
          response.status,
          { cause }
        );
      }

      const parsed = schema.safeParse(payload);

      if (!parsed.success) {
        throw new ExecutorApiError(
          'Executor API returned an invalid response payload',
          response.status,
          { cause: parsed.error }
        );
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
        null,
        { cause: error }
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
      executionJobSchema,
      false
    );

    if (!executionJob) {
      throw new ExecutorApiError('Executor API returned an empty mutation response', null);
    }

    return executionJob;
  };

  return {
    claim: (input) => request('/internal/execution-jobs/claim', input, executionJobSchema, true),
    start: (id, input) => mutate(id, 'start', input),
    renew: (id, input) => mutate(id, 'renew', input),
    complete: (id, input) => mutate(id, 'complete', input),
    fail: (id, input) => mutate(id, 'fail', input),
    context: async (id, input) => {
      const context = await request(
        `/internal/execution-jobs/${encodeURIComponent(id)}/context`,
        input,
        executionResourceContextSchema,
        false
      );

      if (!context) {
        throw new ExecutorApiError('Executor API returned an empty context response', null);
      }

      return context;
    },
    artifactUploadGrant: async (id, input) => {
      const grant = await request(
        `/internal/execution-jobs/${encodeURIComponent(id)}/artifact-upload-grant`,
        input,
        browserAuditArtifactUploadGrantSchema,
        false
      );

      if (!grant) {
        throw new ExecutorApiError('Executor API returned an empty artifact upload grant', null);
      }

      return grant;
    },
    saveResult: async (id, input) => {
      await request(
        `/internal/execution-jobs/${encodeURIComponent(id)}/result`,
        input,
        null,
        true
      );
    },
    enqueueFollowups: async (id, input) => {
      const followups = await request(
        `/internal/execution-jobs/${encodeURIComponent(id)}/followups`,
        input,
        executionFollowupsResponseSchema,
        false
      );

      if (!followups) {
        throw new ExecutorApiError('Executor API returned an empty follow-up response', null);
      }

      return followups;
    }
  };
};
