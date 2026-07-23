import type {
  CheckProfile,
  CheckProfileRun,
  ExecutionJob,
  LatencyJobDetail,
  LatencyJobTarget,
  ProbeMeasurementResponse,
  RegionCode
} from '@webperf/contracts';
import { isIP } from 'node:net';
import {
  jsonValueSchema,
  probeMeasurementResponseSchema,
  regionCodeSchema,
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
  probeBaseUrls: Partial<Record<RegionCode, string>>;
  allowInsecureProbeHttp?: boolean;
  requestImpl?: PinnedHttpRequest;
  logger?: { error(event: Record<string, unknown>): void };
};

export const parseProbeBaseUrls = (
  json: string,
  { allowInsecureHttp = false }: { allowInsecureHttp?: boolean } = {}
): Partial<Record<RegionCode, string>> => {
  let value: unknown;

  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('Executor probe origins must be valid JSON');
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Executor probe origins must be a JSON object');
  }

  const entries = Object.entries(value).map(([region, baseUrl]) => {
    const parsedRegion = regionCodeSchema.safeParse(region);

    if (!parsedRegion.success || typeof baseUrl !== 'string') {
      throw new Error('Executor probe origins contain an invalid region entry');
    }

    const endpoint = resolveProbeMeasureUrl(baseUrl, allowInsecureHttp);
    return [parsedRegion.data, endpoint.origin] as const;
  });

  if (entries.length === 0) {
    throw new Error('Executor requires at least one probe origin');
  }

  return Object.fromEntries(entries);
};

export const createNetworkExecutionHandler = ({
  client,
  leaseOwner,
  probeSharedSecret,
  probeBaseUrls,
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

  for (const job of jobs) {
    await processNetworkJob({
      executionJob,
      job,
      persist,
      probeSharedSecret,
      probeBaseUrls,
      allowInsecureProbeHttp,
      requestImpl,
      logger,
      signal
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
};

const processNetworkJob = async ({
  executionJob,
  job,
  persist,
  probeSharedSecret,
  probeBaseUrls,
  allowInsecureProbeHttp,
  requestImpl,
  logger,
  signal
}: {
  executionJob: ExecutionJob;
  job: LatencyJobDetail;
  persist: () => Promise<void>;
  probeSharedSecret: string;
  probeBaseUrls: Partial<Record<RegionCode, string>>;
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
    recomputeJob(job);
    await persist();

    const probeBaseUrl = probeBaseUrls[target.region];

    if (!probeBaseUrl) {
      markTargetFailed(target, 'missing_probe_region', 'No probe is configured for this region');
      recomputeJob(job);
      await persist();
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
          recomputeJob(job);
          await persist();
          throw new ExecutionFailure(
            'probe_temporarily_unavailable',
            'Network probe is temporarily unavailable',
            true,
            retryDelayMs(executionJob.attemptCount)
          );
        }

        markTargetFailed(target, `probe_http_${response.status}`, 'Network probe rejected the request');
        recomputeJob(job);
        await persist();
        continue;
      }

      const parsed = probeMeasurementResponseSchema.safeParse(await response.json());

      if (!parsed.success) {
        markTargetFailed(target, 'probe_invalid_payload', 'Network probe returned an invalid result');
        recomputeJob(job);
        await persist();
        continue;
      }

      applyMeasurement(target, parsed.data);
      recomputeJob(job);
      await persist();
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
        recomputeJob(job);
        await persist();
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
        recomputeJob(job);
        await persist();
        throw new ExecutionFailure(
          'probe_temporarily_unavailable',
          'Network probe is temporarily unavailable',
          true,
          retryDelayMs(executionJob.attemptCount)
        );
      }

      markTargetFailed(target, 'probe_transport_failed', 'Network probe request failed');
      recomputeJob(job);
      await persist();
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
  const success = measurement.error == null
    && measurement.statusCode != null
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
    const hostname = url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '');
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
  statusCode == null
    ? 'Network probe did not return an HTTP status'
    : `Status ${statusCode} did not satisfy status_2xx_3xx`;
