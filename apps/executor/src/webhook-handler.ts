import { createHmac } from 'node:crypto';
import type { CheckProfileAlertDelivery, ExecutionJob } from '@webperf/contracts';
import { validateMeasurementUrl } from '@webperf/domain-core';
import type { ExecutorApiClient } from './client';
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
  } catch {
    throw new ExecutionFailure(
      'webhook_target_blocked',
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
    } else if (isRetryableStatus(response.status) && executionJob.attemptCount < executionJob.maxAttempts) {
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

  run.alertDeliveries = [...run.alertDeliveries, delivery];
  await client.saveResult(executionJob.id, {
    leaseOwner,
    result: {
      kind: 'webhook_delivery',
      run
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

const isRetryableStatus = (status: number) => status === 408 || status === 429 || status >= 500;

const retryDelayMs = (attemptCount: number) => Math.min(60_000, 1_000 * 2 ** (attemptCount - 1));

const throwIfAborted = (signal: AbortSignal) => {
  if (!signal.aborted) {
    return;
  }

  throw signal.reason instanceof Error
    ? signal.reason
    : new ExecutionFailure('execution_aborted', 'Execution was aborted', true, 1_000);
};
