import type {
  BrowserAuditResource,
  BrowserAuditWorkerResponse,
  ExecutionJob
} from '@webperf/contracts';
import { isLoopbackHostname } from '@webperf/config/selfhost-executor';
import {
  browserAuditResourceSchema,
  browserAuditWorkerRequestSchema,
  browserAuditWorkerResponseSchema
} from '@webperf/contracts';
import {
  createBrowserAuditSignature,
  type BrowserAuditSignatureRequest
} from '@webperf/domain-core';
import type { BrowserAuditExecutorApiClient } from './client';
import { describeSafeError } from './diagnostics';
import {
  isRetryableHttpStatus,
  redactExecutionText,
  retryDelayMs,
  throwIfAborted
} from './execution-utils';
import { ExecutionFailure } from './runner';

const maximumBrowserAuditResponseContentTypeLength = 160;

export type BrowserAuditHandlerOptions = {
  client: BrowserAuditExecutorApiClient;
  leaseOwner: string;
  browserAuditSharedSecret: string;
  browserAuditBaseUrl?: string;
  allowInsecureBrowserAuditHttp?: boolean;
  fetchImpl?: typeof globalThis.fetch;
  logger?: { error(event: Record<string, unknown>): void };
};

export const createBrowserAuditExecutionHandler = ({
  client,
  leaseOwner,
  browserAuditSharedSecret,
  browserAuditBaseUrl,
  allowInsecureBrowserAuditHttp = false,
  fetchImpl = globalThis.fetch,
  logger = defaultBrowserAuditLogger
}: BrowserAuditHandlerOptions) => {
  const endpoint = browserAuditBaseUrl
    ? resolveBrowserAuditEndpoint(browserAuditBaseUrl, allowInsecureBrowserAuditHttp)
    : null;

  return async (executionJob: ExecutionJob, signal: AbortSignal) => {
    const context = await client.context(executionJob.id, { leaseOwner });

    if (context.kind !== 'browser_audit') {
      throw new ExecutionFailure(
        'invalid_browser_audit_context',
        'Executor received an invalid Browser Audit execution context',
        false
      );
    }

    let audit = structuredClone(context.audit);
    const persist = async () => {
      await client.saveResult(executionJob.id, {
        leaseOwner,
        result: { kind: 'browser_audit', audit }
      });
    };
    const persistAudit = async (nextAudit: BrowserAuditResource) => {
      audit = nextAudit;
      await persist();
    };

    if (['succeeded', 'failed', 'cancelled'].includes(audit.status)) {
      return;
    }

    if (!endpoint) {
      audit = failAudit(audit, 'Browser Audit runner is not configured');
      await persist();
      return;
    }

    const artifactUpload = await client.artifactUploadGrant(executionJob.id, {
      leaseOwner
    });

    const unsignedRequest = {
      executionId: audit.id,
      targetUrl: audit.targetUrl,
      region: audit.region,
      policy: audit.policy,
      customHeaders: audit.customHeaders,
      cookies: audit.cookies,
      artifactUpload,
      timestamp: new Date().toISOString(),
      keyVersion: 'current' as const
    } satisfies BrowserAuditSignatureRequest;
    const workerRequest = browserAuditWorkerRequestSchema.parse({
      ...unsignedRequest,
      signature: await createBrowserAuditSignature(
        browserAuditSharedSecret,
        unsignedRequest
      )
    });

    audit = browserAuditResourceSchema.parse({
      ...audit,
      status: 'running',
      startedAt: audit.startedAt ?? new Date().toISOString(),
      completedAt: null,
      result: null,
      error: null
    });
    await persist();

    let response: Response;

    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(workerRequest),
        signal
      });
    } catch {
      throwIfAborted(signal);
      await retryOrFail({
        executionJob,
        audit,
        persist: persistAudit,
        code: 'browser_audit_runner_unavailable',
        failureMessage: 'Browser Audit runner is unavailable'
      });
      return;
    }

    let payload: unknown = null;

    try {
      payload = await response.json();
    } catch (error) {
      logger.error({
        event: 'browser_audit_response_json_invalid',
        executionId: executionJob.id,
        status: response.status,
        contentType: normalizeBrowserAuditResponseContentType(
          response.headers.get('content-type')
        ),
        ...describeSafeError(error)
      });
      // The status code below determines whether an invalid body is retryable.
    }

    const parsedResponse = browserAuditWorkerResponseSchema.safeParse(payload);

    if (parsedResponse.success && parsedResponse.data.executionId !== audit.id) {
      audit = failAudit(
        audit,
        'Browser Audit runner returned a response for a different execution'
      );
      await persist();
      return;
    }

    if (
      parsedResponse.success
      && parsedResponse.data.status === 'failed'
    ) {
      audit = failAudit(
        audit,
        sanitizeWorkerError(
          parsedResponse.data.error,
          audit,
          artifactUpload.bearerToken
        )
      );
      await persist();
      return;
    }

    if (
      response.ok
      && parsedResponse.success
      && isSuccessfulWorkerResponse(parsedResponse.data)
    ) {
      audit = browserAuditResourceSchema.parse({
        ...audit,
        status: 'succeeded',
        startedAt: parsedResponse.data.result.startedAt,
        completedAt: parsedResponse.data.result.completedAt,
        result: parsedResponse.data.result,
        error: null
      });
      await persist();
      return;
    }

    if (
      response.ok
      || response.status === 409
      || isRetryableHttpStatus(response.status)
    ) {
      await retryOrFail({
        executionJob,
        audit,
        persist: persistAudit,
        code: 'browser_audit_runner_unavailable',
        failureMessage: 'Browser Audit runner is temporarily unavailable'
      });
      return;
    }

    audit = failAudit(
      audit,
      response.status === 401 || response.status === 403
        ? 'Browser Audit runner rejected authentication'
        : 'Browser Audit runner returned an invalid response'
    );
    await persist();
  };
};

export const resolveBrowserAuditEndpoint = (
  baseUrl: string,
  allowInsecureHttp = false
) => {
  let url: URL;

  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('Browser Audit runner URL is invalid');
  }

  const loopbackHostname = isLoopbackHostname(url.hostname);
  const protocolAllowed = url.protocol === 'https:'
    || (url.protocol === 'http:' && (loopbackHostname || allowInsecureHttp));

  if (
    !protocolAllowed
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
  ) {
    throw new Error('Browser Audit runner URL must be an allowed credential-free origin');
  }

  return new URL('/audit', url);
};

const retryOrFail = async ({
  executionJob,
  audit,
  persist,
  code,
  failureMessage
}: {
  executionJob: ExecutionJob;
  audit: BrowserAuditResource;
  persist: (audit: BrowserAuditResource) => Promise<void>;
  code: string;
  failureMessage: string;
}) => {
  if (executionJob.attemptCount < executionJob.maxAttempts) {
    await persist(browserAuditResourceSchema.parse({
      ...audit,
      status: 'queued',
      completedAt: null,
      result: null,
      error: 'Browser Audit execution will be retried'
    }));
    throw new ExecutionFailure(
      code,
      failureMessage,
      true,
      retryDelayMs(executionJob.attemptCount)
    );
  }

  await persist(failAudit(audit, failureMessage));
};

const failAudit = (audit: BrowserAuditResource, error: string) =>
  browserAuditResourceSchema.parse({
    ...audit,
    status: 'failed',
    startedAt: audit.startedAt ?? new Date().toISOString(),
    completedAt: new Date().toISOString(),
    result: null,
    error
  });

const sanitizeWorkerError = (
  error: string | null,
  audit: BrowserAuditResource,
  artifactUploadBearerToken: string
) => redactExecutionText(
  error ?? 'Browser Audit failed',
  [
    artifactUploadBearerToken,
    ...audit.customHeaders.map((header) => header.value),
    ...audit.cookies.map((cookie) => cookie.value)
  ]
);

const isSuccessfulWorkerResponse = (
  response: BrowserAuditWorkerResponse
): response is BrowserAuditWorkerResponse & { status: 'succeeded'; result: NonNullable<BrowserAuditWorkerResponse['result']> } =>
  response.status === 'succeeded' && response.result !== null;

const normalizeBrowserAuditResponseContentType = (value: string | null) => {
  if (value === null) {
    return 'missing';
  }
  if (value.length > maximumBrowserAuditResponseContentTypeLength) {
    return 'invalid';
  }
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return /^[a-z0-9][a-z0-9.+_-]{0,63}\/[a-z0-9][a-z0-9.+_-]{0,63}$/.test(mediaType)
    ? mediaType
    : 'invalid';
};

const defaultBrowserAuditLogger = {
  error: (event: Record<string, unknown>) => {
    console.error(JSON.stringify({ service: 'webperf-executor', level: 'error', ...event }));
  }
};
