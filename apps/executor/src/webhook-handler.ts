import { createHmac } from 'node:crypto';
import type { CheckProfileAlertDelivery, ExecutionJob } from '@webperf/contracts';
import { UrlValidationError, validateMeasurementUrl } from '@webperf/domain-core';
import type { ExecutorApiClient } from './client';
import { isRetryableHttpStatus, retryDelayMs, throwIfAborted } from './execution-utils';
import { ExecutionFailure } from './runner';

export type WebhookHandlerOptions = {
  client: ExecutorApiClient;
  leaseOwner: string;
  fetchImpl?: typeof globalThis.fetch;
  validateUrl?: (url: string) => void;
};

export const createWebhookExecutionHandler = ({
  client,
  leaseOwner,
  fetchImpl = globalThis.fetch,
  validateUrl = validateMeasurementUrl
}: WebhookHandlerOptions) => async (executionJob: ExecutionJob, signal: AbortSignal) => {
  const context = await client.context(executionJob.id, { leaseOwner });

  if (context.kind !== 'webhook_delivery') {
    throw new ExecutionFailure(
      'invalid_webhook_context',
      'Executor received an invalid webhook execution context',
      false
    );
  }

  const run = structuredClone(context.run);
  const { target, body } = context.payload;

  if (run.alertDeliveries.some((delivery) => delivery.targetId === target.id)) {
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
  let delivery: CheckProfileAlertDelivery;

  try {
    const response = await fetchImpl(target.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': executionJob.id,
        ...(target.secret
          ? { 'x-webperf-signature': createWebhookSignature(target.secret, serializedBody) }
          : {})
      },
      body: serializedBody,
      signal
    });

    if (response.ok) {
      delivery = buildDelivery(target, 'sent', response.status, null);
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
        'Webhook endpoint rejected the delivery'
      );
    }
  } catch (error) {
    throwIfAborted(signal);

    if (error instanceof ExecutionFailure) {
      throw error;
    }

    if (executionJob.attemptCount < executionJob.maxAttempts) {
      throw new ExecutionFailure(
        'webhook_temporarily_unavailable',
        'Webhook endpoint is temporarily unavailable',
        true,
        retryDelayMs(executionJob.attemptCount)
      );
    }

    delivery = buildDelivery(target, 'failed', null, 'Webhook delivery failed');
  }

  await client.saveResult(executionJob.id, {
    leaseOwner,
    result: {
      kind: 'webhook_delivery',
      runId: run.id,
      delivery
    }
  });
};

const createWebhookSignature = (secret: string, body: string) =>
  `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;

const buildDelivery = (
  target: {
    id: string;
    name: string;
    url: string;
  },
  status: CheckProfileAlertDelivery['status'],
  responseStatus: number | null,
  error: string | null
): CheckProfileAlertDelivery => ({
  targetId: target.id,
  targetName: target.name,
  url: target.url,
  deliveredAt: new Date().toISOString(),
  status,
  responseStatus,
  error
});
