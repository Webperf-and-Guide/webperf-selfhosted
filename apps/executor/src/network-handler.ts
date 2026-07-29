import type {
  CheckProfile,
  CheckProfileRun,
  ExecutionJob,
  LatencyJobDetail,
  LatencyJobTarget,
  ProbeMeasurementResponse
} from '@webperf/contracts';
import { isIP } from 'node:net';
import {
  jsonValueSchema,
  probeMeasurementResponseSchema,
  signedProbeMeasurementRequestSchema
} from '@webperf/contracts';
import { isLoopbackHostname } from '@webperf/config/selfhost-executor';
import { createProbeSignature, type ProbeSignatureRequest } from '@webperf/domain-core';
import {
  buildCheckProfileComparison,
  deriveJobStatus,
  evaluateMonitorTargets,
  summarizeTargets
} from '@webperf/report-core';
import { ExecutorApiError, type ExecutorApiClient } from './client';
import { describeSafeError } from './diagnostics';
import { isRetryableHttpStatus, retryDelayMs, throwIfAborted } from './execution-utils';
import {
  normalizeOutboundHostname,
  OutboundHttpPolicyError,
  requestPinnedHttp,
  type OutboundAddressPolicy,
  type PinnedHttpRequest
} from './outbound-http';
import { ExecutionFailure } from './runner';

export type NetworkHandlerOptions = {
  client: ExecutorApiClient;
  leaseOwner: string;
  probeSharedSecret: string;
  // Phase 1 of issue #14: one standalone deployment measures from one fixed
  // probe origin. The legacy region->origin map was replaced by a single
  // credential-free HTTP(S) origin string.
  probeBaseUrl: string;
  allowInsecureProbeHttp?: boolean;
  requestImpl?: PinnedHttpRequest;
  logger?: { error(event: Record<string, unknown>): void };
};

export const parseProbeBaseUrl = (
  baseUrl: string,
  { allowInsecureHttp = false }: { allowInsecureHttp?: boolean } = {}
): string => {
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    throw new Error('Executor probe origin must be a non-empty string');
  }

  const endpoint = resolveProbeMeasureUrl(baseUrl, allowInsecureHttp);
  return endpoint.origin;
};

export const createNetworkExecutionHandler = ({
  client,
  leaseOwner,
  probeSharedSecret,
  probeBaseUrl,
  allowInsecureProbeHttp = false,
  requestImpl = requestPinnedHttp,
  logger = defaultNetworkLogger
}: NetworkHandlerOptions) => async (executionJob: ExecutionJob, signal: AbortSignal) => {
  const context = await client.context(executionJob.id, { leaseOwner });

  if (context.kind !== 'network_probe') {
    throw new ExecutionFailure(
      'invalid_network_context',
      'Executor received an invalid network execution context',
      false
    );
  }

  const deadline = createExecutionDeadlineSignal(context.payload.deadlineAt, signal);
  const jobs = context.jobs.map((job) => structuredClone(job));
  let run = context.run ? structuredClone(context.run) : null;
  const persist = async () => {
    await client.saveResult(executionJob.id, {
      leaseOwner,
      result: {
        kind: 'network_probe',
        jobs,
        run
      }
    });
  };

  try {
    for (const job of jobs) {
      await processNetworkJob({
        executionJob,
        job,
        persist,
        probeSharedSecret,
        probeBaseUrl,
        allowInsecureProbeHttp,
        requestImpl,
        logger,
        signal: deadline.signal
      });
    }

    if (run && context.check) {
      const comparison = context.comparisonMode
        ? buildCheckProfileComparison({
            currentRun: run,
            currentJobs: jobs,
            comparedRun: context.comparedRun,
            comparedJobs: context.comparedJobs,
            mode: context.comparisonMode
          })
        : null;
      run = {
        ...run,
        evaluation: evaluateMonitorTargets({
          monitorPolicy: context.check.monitorPolicy,
          targets: jobs.flatMap((job) => job.targets),
          regressedCount: comparison?.summary.regressed ?? 0
        })
      };
      await persist();

      const followups = buildWebhookFollowups({
        executionJob,
        run,
        check: context.check,
        jobs,
        comparisonSummary: comparison?.summary ?? null
      });

      if (followups.length > 0) {
        await client.enqueueFollowups(executionJob.id, {
          leaseOwner,
          jobs: followups
        });
      }
    }
  } finally {
    deadline.dispose();
  }
};

const createExecutionDeadlineSignal = (
  deadlineAt: string | null,
  parentSignal: AbortSignal
) => {
  if (!deadlineAt) {
    return {
      signal: parentSignal,
      dispose: () => {}
    };
  }

  const parsedDeadlineMs = Date.parse(deadlineAt);
  if (Number.isNaN(parsedDeadlineMs)) {
    throw new ExecutionFailure(
      'regional_execution_invalid_deadline',
      'Regional execution deadline is invalid',
      false
    );
  }

  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal.reason);
  if (parentSignal.aborted) {
    abortFromParent();
  } else {
    parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }

  const abortForDeadline = () => controller.abort(new ExecutionFailure(
    'regional_execution_deadline_exceeded',
    'Regional execution exceeded its accepted deadline',
    false
  ));
  const remainingMs = parsedDeadlineMs - Date.now();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  if (remainingMs <= 0) {
    abortForDeadline();
  } else {
    timeout = setTimeout(abortForDeadline, remainingMs);
    timeout.unref?.();
  }

  return {
    signal: controller.signal,
    dispose() {
      if (timeout) {
        clearTimeout(timeout);
      }
      parentSignal.removeEventListener('abort', abortFromParent);
    }
  };
};

const processNetworkJob = async ({
  executionJob,
  job,
  persist,
  probeSharedSecret,
  probeBaseUrl,
  allowInsecureProbeHttp,
  requestImpl,
  logger,
  signal
}: {
  executionJob: ExecutionJob;
  job: LatencyJobDetail;
  persist: () => Promise<void>;
  probeSharedSecret: string;
  probeBaseUrl: string;
  allowInsecureProbeHttp: boolean;
  requestImpl: PinnedHttpRequest;
  logger: { error(event: Record<string, unknown>): void };
  signal: AbortSignal;
}) => {
  if (job.completedAt && job.summary.inflight === 0) {
    return;
  }

  for (const target of job.targets) {
    if (target.status === 'succeeded' || target.status === 'failed') {
      continue;
    }

    throwIfAborted(signal);
    const now = new Date().toISOString();
    job.startedAt ??= now;
    job.completedAt = null;
    target.attemptNo = executionJob.attemptCount;
    target.status = 'measuring';
    target.startedAt ??= now;
    target.finishedAt = null;
    target.updatedAt = now;
    await recomputeAndPersistJob(job, persist);

    // Phase 1 of issue #14: the deployment owns one fixed probe origin. The
    // previous per-target region lookup was removed; if the operator has not
    // configured an origin, mark the target as missing-probe-origin.
    if (!probeBaseUrl) {
      markTargetFailed(target, 'missing_probe_origin', 'No probe origin is configured for this deployment');
      await recomputeAndPersistJob(job, persist);
      continue;
    }

    try {
      const unsignedPayload = {
        jobId: job.id,
        targetId: `${job.id}:${target.region}`,
        region: target.region,
        url: job.url,
        request: job.request,
        timestamp: new Date().toISOString(),
        keyVersion: 'current' as const
      } satisfies ProbeSignatureRequest;
      const payload = signedProbeMeasurementRequestSchema.parse({
        ...unsignedPayload,
        signature: await createProbeSignature(probeSharedSecret, unsignedPayload)
      });
      const measureUrl = resolveProbeMeasureUrl(probeBaseUrl, allowInsecureProbeHttp);
      const response = await requestImpl(measureUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
        addressPolicy: probeAddressPolicy(measureUrl, allowInsecureProbeHttp)
      });

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (isRetryableHttpStatus(response.status) && executionJob.attemptCount < executionJob.maxAttempts) {
          markTargetRetryable(target, `probe_http_${response.status}`);
          await recomputeAndPersistJob(job, persist);
          throw new ExecutionFailure(
            'probe_temporarily_unavailable',
            'Network probe is temporarily unavailable',
            true,
            retryDelayMs(executionJob.attemptCount)
          );
        }

        markTargetFailed(target, `probe_http_${response.status}`, 'Network probe rejected the request');
        await recomputeAndPersistJob(job, persist);
        continue;
      }

      const parsed = probeMeasurementResponseSchema.safeParse(await response.json());

      if (!parsed.success) {
        markTargetFailed(target, 'probe_invalid_payload', 'Network probe returned an invalid result');
        await recomputeAndPersistJob(job, persist);
        continue;
      }

      if (parsed.data.measurement.region !== target.region) {
        markTargetFailed(
          target,
          'probe_region_mismatch',
          'Network probe returned a result from an unexpected region'
        );
        await recomputeAndPersistJob(job, persist);
        continue;
      }

      applyMeasurement(target, parsed.data);
      await recomputeAndPersistJob(job, persist);
    } catch (error) {
      throwIfAborted(signal);

      if (error instanceof ExecutorApiError || error instanceof ExecutionFailure) {
        throw error;
      }

      if (
        error instanceof OutboundHttpPolicyError
        && (error.code === 'address_blocked' || error.code === 'invalid_target')
      ) {
        markTargetFailed(
          target,
          'probe_origin_blocked',
          'Network probe origin resolved to a blocked address'
        );
        await recomputeAndPersistJob(job, persist);
        continue;
      }

      logger.error({
        event: 'probe_request_failed',
        jobId: job.id,
        region: target.region,
        ...describeSafeError(error)
      });

      if (executionJob.attemptCount < executionJob.maxAttempts) {
        markTargetRetryable(target, 'probe_transport_failed');
        await recomputeAndPersistJob(job, persist);
        throw new ExecutionFailure(
          'probe_temporarily_unavailable',
          'Network probe is temporarily unavailable',
          true,
          retryDelayMs(executionJob.attemptCount)
        );
      }

      markTargetFailed(target, 'probe_transport_failed', 'Network probe request failed');
      await recomputeAndPersistJob(job, persist);
    }
  }

  recomputeJob(job);
  if (job.summary.inflight === 0) {
    job.completedAt = new Date().toISOString();
  }
  await persist();
};

const applyMeasurement = (
  target: LatencyJobTarget,
  response: ProbeMeasurementResponse
) => {
  const measurement = response.measurement;
  const success = (measurement.error === null || measurement.error === undefined)
    && measurement.statusCode !== null
    && measurement.statusCode !== undefined
    && measurement.statusCode >= 200
    && measurement.statusCode < 400;
  target.status = success ? 'succeeded' : 'failed';
  target.latencyMs = measurement.latencyMs;
  target.statusCode = measurement.statusCode;
  target.success = success;
  target.probeImpl = measurement.probeImpl;
  target.measurement = measurement;
  target.errorCode = null;
  target.errorMessage = null;

  if (measurement.error) {
    target.errorCode = 'probe_measurement_failed';
    target.errorMessage = 'Network probe measurement failed';
  } else if (!success) {
    target.errorCode = 'status_rule_failed';
    target.errorMessage = buildStatusFailureMessage(measurement.statusCode);
  }

  target.errorClass = success ? null : 'terminal';
  target.finishedAt = measurement.measuredAt;
  target.updatedAt = new Date().toISOString();
};

const markTargetRetryable = (target: LatencyJobTarget, errorCode: string) => {
  resetTargetMeasurement(target);
  target.status = 'queued';
  target.errorCode = errorCode;
  target.errorClass = 'retryable';
  target.errorMessage = 'Network probe will be retried';
  target.finishedAt = null;
  target.updatedAt = new Date().toISOString();
};

const markTargetFailed = (
  target: LatencyJobTarget,
  errorCode: string,
  errorMessage: string
) => {
  resetTargetMeasurement(target);
  target.status = 'failed';
  target.success = false;
  target.slotId = null;
  target.errorCode = errorCode;
  target.errorClass = 'terminal';
  target.errorMessage = errorMessage;
  target.finishedAt = new Date().toISOString();
  target.updatedAt = new Date().toISOString();
};

const resetTargetMeasurement = (target: LatencyJobTarget) => {
  target.latencyMs = null;
  target.statusCode = null;
  target.success = null;
  target.probeImpl = null;
  target.measurement = null;
  target.errorCode = null;
  target.errorClass = null;
  target.errorMessage = null;
  target.finishedAt = null;
};

const recomputeJob = (job: LatencyJobDetail) => {
  job.summary = summarizeTargets(job.targets);
  job.status = deriveJobStatus(job.targets);
  job.evaluation = evaluateMonitorTargets({
    monitorPolicy: job.monitorPolicy,
    targets: job.targets
  });
};

const recomputeAndPersistJob = async (
  job: LatencyJobDetail,
  persist: () => Promise<void>
) => {
  recomputeJob(job);
  await persist();
};

const buildWebhookFollowups = ({
  executionJob,
  run,
  check,
  jobs,
  comparisonSummary
}: {
  executionJob: ExecutionJob;
  run: CheckProfileRun;
  check: CheckProfile;
  jobs: LatencyJobDetail[];
  comparisonSummary: ReturnType<typeof buildCheckProfileComparison>['summary'] | null;
}) => {
  const evaluation = run.evaluation;

  if (!check.alerts?.enabled || !evaluation) {
    return [];
  }

  const shouldAlert =
    (check.alerts.triggers.onFailure && evaluation.failedChecks > 0)
    || (check.alerts.triggers.onLatencyThresholdBreach && evaluation.thresholdBreached)
    || (check.alerts.triggers.onRegression && evaluation.regressionDetected);

  if (!shouldAlert) {
    return [];
  }

  const body = jsonValueSchema.parse({
    type: 'check.alert',
    check: { id: check.id, name: check.name },
    run: { id: run.id, createdAt: run.createdAt, trigger: run.trigger },
    evaluation,
    jobs: jobs.map((job) => ({
      id: job.id,
      url: job.url,
      status: job.status,
      evaluation: job.evaluation ?? null,
      summary: job.summary
    })),
    comparison: comparisonSummary ? { summary: comparisonSummary } : null
  });

  return check.alerts.webhookTargets
    .filter((target) => target.enabled)
    .map((target) => ({
      id: `exec_${run.id}_${target.id}`,
      kind: 'webhook_delivery' as const,
      resourceId: run.id,
      maxAttempts: executionJob.maxAttempts,
      payload: {
        version: 'v1' as const,
        runId: run.id,
        target,
        body
      }
    }));
};

const resolveProbeMeasureUrl = (baseUrl: string, allowInsecureHttp: boolean) => {
  let url: URL;

  try {
    url = new URL(baseUrl);
  } catch {
    throw new ExecutionFailure(
      'invalid_probe_origin',
      'Network probe origin is invalid',
      false
    );
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
    throw new ExecutionFailure(
      'invalid_probe_origin',
      'Network probe origin is invalid',
      false
    );
  }

  return new URL('/measure', url);
};

const probeAddressPolicy = (
  url: URL,
  allowInsecureHttp: boolean
): OutboundAddressPolicy => {
  if (isLoopbackHostname(url.hostname)) {
    return 'loopback';
  }

  if (allowInsecureHttp) {
    const hostname = normalizeOutboundHostname(url.hostname);
    if (
      isIP(hostname) > 0
      || !hostname.includes('.')
      || hostname.endsWith('.local')
      || hostname.endsWith('.internal')
    ) {
      return 'trusted-private';
    }
  }
  return 'public';
};

const defaultNetworkLogger = {
  error(event: Record<string, unknown>) {
    console.error(JSON.stringify({ service: 'webperf-executor', level: 'error', ...event }));
  }
};

const buildStatusFailureMessage = (statusCode: number | null | undefined) =>
  statusCode === null || statusCode === undefined
    ? 'Network probe did not return an HTTP status'
    : `Status ${statusCode} did not satisfy status_2xx_3xx`;
