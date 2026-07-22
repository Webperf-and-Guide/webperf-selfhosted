import type {
  CheckProfile,
  CheckProfileRun,
  ExecutionJob,
  LatencyJobDetail,
  LatencyJobTarget,
  ProbeMeasurementResponse,
  RegionCode,
  SignedProbeMeasurementRequest
} from '@webperf/contracts';
import {
  jsonValueSchema,
  probeMeasurementResponseSchema,
  regionCodeSchema,
  signedProbeMeasurementRequestSchema
} from '@webperf/contracts';
import { createProbeSignature } from '@webperf/domain-core';
import {
  buildCheckProfileComparison,
  deriveJobStatus,
  evaluateMonitorTargets,
  summarizeTargets
} from '@webperf/report-core';
import { ExecutorApiError, type ExecutorApiClient } from './client';
import { ExecutionFailure } from './runner';

export type NetworkHandlerOptions = {
  client: ExecutorApiClient;
  leaseOwner: string;
  probeSharedSecret: string;
  probeBaseUrls: Partial<Record<RegionCode, string>>;
  fetchImpl?: typeof globalThis.fetch;
};

export const parseProbeBaseUrls = (json: string): Partial<Record<RegionCode, string>> => {
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

    const endpoint = resolveProbeMeasureUrl(baseUrl);
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
  fetchImpl = globalThis.fetch
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
      fetchImpl,
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
  fetchImpl,
  signal
}: {
  executionJob: ExecutionJob;
  job: LatencyJobDetail;
  persist: () => Promise<void>;
  probeSharedSecret: string;
  probeBaseUrls: Partial<Record<RegionCode, string>>;
  fetchImpl: typeof globalThis.fetch;
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
      const payload = signedProbeMeasurementRequestSchema.parse({
        jobId: job.id,
        targetId: `${job.id}:${target.region}`,
        region: target.region,
        url: job.url,
        request: job.request,
        timestamp: new Date().toISOString(),
        signature: 'placeholder-signature',
        keyVersion: 'current'
      });
      payload.signature = await createProbeSignature(probeSharedSecret, payload);
      const response = await fetchImpl(resolveProbeMeasureUrl(probeBaseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload satisfies SignedProbeMeasurementRequest),
        signal
      });

      if (!response.ok) {
        if (isRetryableStatus(response.status) && executionJob.attemptCount < executionJob.maxAttempts) {
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

      const parsed = probeMeasurementResponseSchema.safeParse(
        (await response.json()) as ProbeMeasurementResponse
      );

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
  target.status = 'queued';
  target.latencyMs = null;
  target.statusCode = null;
  target.success = null;
  target.probeImpl = null;
  target.measurement = null;
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
  target.status = 'failed';
  target.latencyMs = null;
  target.statusCode = null;
  target.success = false;
  target.probeImpl = null;
  target.measurement = null;
  target.slotId = null;
  target.errorCode = errorCode;
  target.errorClass = 'terminal';
  target.errorMessage = errorMessage;
  target.finishedAt = new Date().toISOString();
  target.updatedAt = new Date().toISOString();
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

const resolveProbeMeasureUrl = (baseUrl: string) => {
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

  if (
    !['http:', 'https:'].includes(url.protocol)
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

const buildStatusFailureMessage = (statusCode: number | null | undefined) =>
  statusCode == null
    ? 'Network probe did not return an HTTP status'
    : `Status ${statusCode} did not satisfy status_2xx_3xx`;
