import { createHmac } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import type { CheckProfileAlertDelivery, ExecutionJob } from '@webperf/contracts';
import { UrlValidationError, validateMeasurementUrl } from '@webperf/domain-core';
import type { ExecutorApiClient } from './client';
import { describeSafeError, type SafeErrorDiagnostic } from './diagnostics';
import { isRetryableHttpStatus, retryDelayMs, throwIfAborted } from './execution-utils';
import {
  OutboundHttpPolicyError,
  requestPinnedHttp,
  type PinnedHttpRequest
} from './outbound-http';
import { ExecutionFailure } from './runner';

export type WebhookHandlerOptions = {
  client: ExecutorApiClient;
  leaseOwner: string;
  requestImpl?: PinnedHttpRequest;
  validateUrl?: (url: string) => URL | void;
  now?: () => Date;
  logger?: { error(event: Record<string, unknown>): void };
};

export const createWebhookExecutionHandler = ({
  client,
  leaseOwner,
  requestImpl = requestPinnedHttp,
  validateUrl = validateMeasurementUrl,
  now = () => new Date(),
  logger = defaultWebhookLogger
}: WebhookHandlerOptions) => async (executionJob: ExecutionJob, signal: AbortSignal) => {
  const context = await client.context(executionJob.id, { leaseOwner });

  if (context.kind !== 'webhook_delivery') {
    throw new ExecutionFailure(
      'invalid_webhook_context',
      'Executor received an invalid webhook execution context',
      false
    );
  }

  const { id: runId, alertDeliveries } = context.run;
  const { target, body } = context.payload;

  if (alertDeliveries.some((delivery) => delivery.targetId === target.id)) {
    return;
  }

  try {
    validateUrl(target.url);
  } catch (error) {
    const failureCode = error instanceof UrlValidationError
      ? `webhook_target_${error.code}`
      : 'webhook_target_blocked';
    throw new ExecutionFailure(
      failureCode,
      'Webhook target is not allowed',
      false
    );
  }

  const serializedBody = JSON.stringify(body);
  const signatureTimestamp = Math.floor(now().getTime() / 1_000);
  let delivery: CheckProfileAlertDelivery;

  try {
    const response = await requestImpl(new URL(target.url), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': executionJob.id,
        'x-webperf-timestamp': String(signatureTimestamp),
        ...(target.secret
          ? {
              'x-webperf-signature': createWebhookSignature(
                target.secret,
                signatureTimestamp,
                serializedBody
              )
            }
          : {})
      },
      body: serializedBody,
      signal,
      addressPolicy: 'public',
      discardResponseBody: true
    });

    if (response.ok) {
      delivery = buildDelivery(
        target,
        'sent',
        response.status,
        null,
        now().toISOString()
      );
    } else if (isRetryableHttpStatus(response.status) && executionJob.attemptCount < executionJob.maxAttempts) {
      throw new ExecutionFailure(
        'webhook_temporarily_unavailable',
        'Webhook endpoint is temporarily unavailable',
        true,
        retryDelayMs(executionJob.attemptCount)
      );
    } else {
      delivery = buildDelivery(
        target,
        'failed',
        response.status,
        buildWebhookHttpFailure(response.status),
        now().toISOString()
      );
    }
  } catch (error) {
    throwIfAborted(signal);

    if (error instanceof ExecutionFailure) {
      throw error;
    }

    if (
      error instanceof OutboundHttpPolicyError
      && (error.code === 'address_blocked' || error.code === 'invalid_target')
    ) {
      throw new ExecutionFailure(
        'webhook_target_private_ip',
        'Webhook target resolved to a blocked address',
        false
      );
    }

    const diagnostic = describeSafeError(error);
    logger.error({
      event: 'webhook_delivery_failed',
      executionJobId: executionJob.id,
      targetId: target.id,
      ...diagnostic
    });

    if (executionJob.attemptCount < executionJob.maxAttempts) {
      throw new ExecutionFailure(
        'webhook_temporarily_unavailable',
        'Webhook endpoint is temporarily unavailable',
        true,
        retryDelayMs(executionJob.attemptCount)
      );
    }

    delivery = buildDelivery(
      target,
      'failed',
      null,
      buildWebhookTransportFailure(diagnostic),
      now().toISOString()
    );
  }

  await client.saveResult(executionJob.id, {
    leaseOwner,
    result: {
      kind: 'webhook_delivery',
      runId,
      delivery
    }
  });
};

const createWebhookSignature = (
  secret: string,
  timestamp: number,
  body: string
) => `t=${timestamp},v1=${createHmac('sha256', secret)
  .update(`${timestamp}.${body}`, 'utf8')
  .digest('hex')}`;

const buildWebhookHttpFailure = (status: number) => {
  const statusText = STATUS_CODES[status];
  return statusText
    ? `Webhook endpoint rejected the delivery (HTTP ${status} ${statusText})`
    : `Webhook endpoint rejected the delivery (HTTP ${status})`;
};

const buildWebhookTransportFailure = (diagnostic: SafeErrorDiagnostic) => {
  const detail = [
    diagnostic.errorType,
    diagnostic.systemCode ? `code ${diagnostic.systemCode}` : null
  ].filter(Boolean).join(', ');
  return `Webhook delivery failed (${detail})`;
};

const buildDelivery = (
  target: {
    id: string;
    name: string;
    url: string;
  },
  status: CheckProfileAlertDelivery['status'],
  responseStatus: number | null,
  error: string | null,
  deliveredAt: string
): CheckProfileAlertDelivery => ({
  targetId: target.id,
  targetName: target.name,
  url: target.url,
  deliveredAt,
  status,
  responseStatus,
  error
});

const defaultWebhookLogger = {
  error(event: Record<string, unknown>) {
    console.error(JSON.stringify({ service: 'webperf-executor', level: 'error', ...event }));
  }
};
