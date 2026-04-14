import type {
  CheckProfile,
  CheckProfileComparisonMode,
  CheckProfileComparisonResponse,
  CheckProfileComparisonSummary,
  CheckProfileLatestComparisonResponse,
  CheckProfileRouteComparison,
  CheckProfileRun,
  CheckProfileRunReportSummary,
  LatencyJobDetail,
  JobStatus,
  LatencyJobTarget,
  MonitorEvaluation,
  MonitorPolicy,
  MonitorStatus,
  TargetStatus
} from '@webperf/contracts';

export const terminalTargetStatuses = new Set<TargetStatus>(['succeeded', 'failed']);

export const isTerminalTargetStatus = (status: TargetStatus) => terminalTargetStatuses.has(status);

export type LatencyJobSummary = {
  total: number;
  succeeded: number;
  failed: number;
  inflight: number;
};

export const summarizeTargets = (targets: Array<Pick<LatencyJobTarget, 'status'>>): LatencyJobSummary => ({
  total: targets.length,
  succeeded: targets.filter((target) => target.status === 'succeeded').length,
  failed: targets.filter((target) => target.status === 'failed').length,
  inflight: targets.filter((target) => !terminalTargetStatuses.has(target.status)).length
});

export const deriveJobStatus = (targets: Array<Pick<LatencyJobTarget, 'status'>>): JobStatus => {
  if (targets.length === 0) {
    return 'queued';
  }

  const statuses = targets.map((target) => target.status);

  if (statuses.every((status) => status === 'succeeded')) {
    return 'succeeded';
  }

  if (statuses.every((status) => status === 'failed')) {
    return 'failed';
  }

  if (statuses.every((status) => terminalTargetStatuses.has(status))) {
    return 'partial';
  }

  if (statuses.includes('measuring')) {
    return 'measuring';
  }

  if (statuses.includes('healthy')) {
    return 'healthy';
  }

  if (statuses.includes('deploying')) {
    return 'deploying';
  }

  if (statuses.includes('slot_allocating')) {
    return 'slot_allocating';
  }

  return 'queued';
};

type RunRouteJob = {
  routeId: string;
  routeLabel: string;
  url: string;
  job: LatencyJobDetail | null;
};

export const buildCheckProfileComparison = ({
  currentRun,
  currentJobs,
  comparedRun,
  comparedJobs,
  mode
}: {
  currentRun: CheckProfileRun;
  currentJobs: LatencyJobDetail[];
  comparedRun: CheckProfileRun | null;
  comparedJobs: LatencyJobDetail[];
  mode: CheckProfileComparisonMode;
}): Omit<CheckProfileComparisonResponse, 'profile'> => {
  const currentRouteJobs = buildRunRouteJobs(currentRun, currentJobs);
  const comparedRouteJobs = comparedRun ? buildRunRouteJobs(comparedRun, comparedJobs) : [];

  const currentMap = new Map(currentRouteJobs.map((item) => [item.routeId, item] as const));
  const comparedMap = new Map(comparedRouteJobs.map((item) => [item.routeId, item] as const));
  const routeIds = [...new Set([...currentMap.keys(), ...comparedMap.keys()])];

  const routes = routeIds.map<CheckProfileRouteComparison>((routeId) => {
    const current = currentMap.get(routeId) ?? null;
    const previous = comparedMap.get(routeId) ?? null;
    const routeLabel = current?.routeLabel ?? previous?.routeLabel ?? routeId;
    const url = current?.url ?? previous?.url ?? 'http://invalid.local';
    const currentTargets = current?.job?.targets ?? [];
    const previousTargets = previous?.job?.targets ?? [];
    const regionKeys = [
      ...new Set([...currentTargets.map((target) => target.region), ...previousTargets.map((target) => target.region)])
    ];

    return {
      routeId,
      routeLabel,
      url,
      regions: regionKeys.map((region) => {
        const currentTarget = currentTargets.find((target) => target.region === region) ?? null;
        const previousTarget = previousTargets.find((target) => target.region === region) ?? null;
        const currentLatency = currentTarget?.latencyMs ?? null;
        const previousLatency = previousTarget?.latencyMs ?? null;
        const latencyDeltaMs =
          currentLatency != null && previousLatency != null ? currentLatency - previousLatency : null;
        const latencyDeltaPct =
          latencyDeltaMs != null && previousLatency && previousLatency > 0
            ? Number((((currentLatency ?? 0) - previousLatency) / previousLatency * 100).toFixed(2))
            : null;

        return {
          region,
          currentJobId: current?.job?.id ?? null,
          previousJobId: previous?.job?.id ?? null,
          currentStatus: current?.job?.status ?? null,
          previousStatus: previous?.job?.status ?? null,
          currentLatencyMs: currentLatency,
          previousLatencyMs: previousLatency,
          currentStatusCode: currentTarget?.statusCode ?? null,
          previousStatusCode: previousTarget?.statusCode ?? null,
          currentFinalUrl: currentTarget?.measurement?.finalUrl ?? null,
          previousFinalUrl: previousTarget?.measurement?.finalUrl ?? null,
          currentProbeImpl: currentTarget?.probeImpl ?? null,
          previousProbeImpl: previousTarget?.probeImpl ?? null,
          currentErrorMessage: currentTarget?.errorMessage ?? null,
          previousErrorMessage: previousTarget?.errorMessage ?? null,
          latencyDeltaMs,
          latencyDeltaPct,
          classification: classifyRunDelta({
            currentTarget,
            previousTarget,
            currentJob: current?.job ?? null,
            previousJob: previous?.job ?? null
          }),
          statusChanged: (current?.job?.status ?? null) !== (previous?.job?.status ?? null)
        };
      })
    };
  });

  return {
    currentRun,
    comparedRun,
    mode,
    summary: summarizeRunComparison(routes),
    routes
  };
};

export const compareCheckProfileRuns = ({
  currentRun,
  currentJobs,
  previousRun,
  previousJobs
}: {
  currentRun: CheckProfileRun;
  currentJobs: LatencyJobDetail[];
  previousRun: CheckProfileRun | null;
  previousJobs: LatencyJobDetail[];
}): Pick<CheckProfileLatestComparisonResponse, 'summary' | 'routes'> => {
  const comparison = buildCheckProfileComparison({
    currentRun,
    currentJobs,
    comparedRun: previousRun,
    comparedJobs: previousJobs,
    mode: 'latest_previous'
  });

  return {
    summary: comparison.summary,
    routes: comparison.routes
  };
};

const defaultMonitorPolicy: MonitorPolicy = {
  monitorType: 'latency',
  successRule: 'status_2xx_3xx',
  latencyThresholdMs: null
};

export const evaluateMonitorTargets = ({
  monitorPolicy,
  targets,
  regressedCount = 0
}: {
  monitorPolicy?: MonitorPolicy | null;
  targets: Array<Pick<LatencyJobTarget, 'statusCode' | 'latencyMs' | 'errorMessage' | 'status'>>;
  regressedCount?: number;
}): MonitorEvaluation => {
  const effectivePolicy = monitorPolicy ?? defaultMonitorPolicy;
  const failedChecks = targets.filter((target) => !isTargetSuccessful(target)).length;
  const thresholdBreachedCount = effectivePolicy.latencyThresholdMs
    ? targets.filter(
        (target) =>
          target.latencyMs != null && target.latencyMs > (effectivePolicy.latencyThresholdMs ?? Number.MAX_SAFE_INTEGER)
      ).length
    : 0;
  const worstLatencyMs = targets
    .map((target) => target.latencyMs)
    .filter((value): value is number => value != null)
    .reduce<number | null>((worst, value) => (worst == null || value > worst ? value : worst), null);
  const totalChecks = targets.length;
  const healthyChecks = Math.max(totalChecks - failedChecks, 0);
  const thresholdBreached = thresholdBreachedCount > 0;
  const regressionDetected = regressedCount > 0;

  let status: MonitorStatus = 'healthy';

  if (failedChecks > 0) {
    status = 'failed';
  } else if (thresholdBreached || regressionDetected) {
    status = 'warning';
  }

  return {
    monitorType: effectivePolicy.monitorType,
    successRule: effectivePolicy.successRule,
    status,
    totalChecks,
    healthyChecks,
    failedChecks,
    latencyThresholdMs: effectivePolicy.latencyThresholdMs ?? null,
    thresholdBreached,
    thresholdBreachedCount,
    worstLatencyMs,
    regressionDetected,
    regressedCount
  };
};

export const summarizeCheckProfileRunReport = ({
  profile,
  run,
  jobs,
  regressedCount = 0
}: {
  profile: CheckProfile;
  run: CheckProfileRun;
  jobs: LatencyJobDetail[];
  regressedCount?: number;
}): CheckProfileRunReportSummary => {
  const targets = jobs.flatMap((job) => job.targets);
  const evaluation = run.evaluation ?? evaluateMonitorTargets({
    monitorPolicy: profile.monitorPolicy,
    targets,
    regressedCount
  });

  return {
    runId: run.id,
    createdAt: run.createdAt,
    trigger: run.trigger,
    routeCount: run.routeCount,
    jobCount: jobs.length,
    status: evaluation.status,
    evaluation,
    alertDeliveries: run.alertDeliveries,
    baselinePinned: profile.baseline?.runId === run.id
  };
};

export const buildCheckProfileReportCsv = ({
  profile,
  runs
}: {
  profile: CheckProfile;
  runs: CheckProfileRunReportSummary[];
}) => {
  const rows = [
    [
      'profile_id',
      'profile_name',
      'run_id',
      'created_at',
      'trigger',
      'route_count',
      'job_count',
      'status',
      'monitor_type',
      'failed_checks',
      'threshold_breached',
      'regression_detected',
      'baseline_pinned'
    ],
    ...runs.map((run) => [
      profile.id,
      profile.name,
      run.runId,
      run.createdAt,
      run.trigger,
      run.routeCount.toString(),
      run.jobCount.toString(),
      run.status,
      run.evaluation?.monitorType ?? '',
      run.evaluation?.failedChecks?.toString() ?? '0',
      String(run.evaluation?.thresholdBreached ?? false),
      String(run.evaluation?.regressionDetected ?? false),
      String(run.baselinePinned)
    ])
  ];

  return rows
    .map((row) =>
      row
        .map((value) => {
          const escaped = value.replaceAll('"', '""');
          return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
        })
        .join(',')
    )
    .join('\n');
};

const buildRunRouteJobs = (run: CheckProfileRun, jobs: LatencyJobDetail[]): RunRouteJob[] => {
  const jobMap = new Map(jobs.map((job) => [job.id, job] as const));

  return run.routes.map((route) => ({
    routeId: route.routeId,
    routeLabel: route.routeLabel,
    url: route.url,
    job: jobMap.get(route.jobId) ?? null
  }));
};

const summarizeRunComparison = (routes: CheckProfileRouteComparison[]): CheckProfileComparisonSummary =>
  routes.reduce<CheckProfileComparisonSummary>(
    (summary, route) => {
      summary.routesCompared += 1;

      for (const region of route.regions) {
        summary.regionsCompared += 1;

        if (region.classification === 'improved') {
          summary.improved += 1;
        } else if (region.classification === 'regressed') {
          summary.regressed += 1;
        } else if (region.classification === 'missing_previous') {
          summary.missingPrevious += 1;
        } else if (region.classification === 'missing_current') {
          summary.missingCurrent += 1;
        } else {
          summary.unchanged += 1;
        }
      }

      return summary;
    },
    {
      routesCompared: 0,
      regionsCompared: 0,
      improved: 0,
      regressed: 0,
      unchanged: 0,
      missingPrevious: 0,
      missingCurrent: 0
    }
  );

const classifyRunDelta = ({
  currentTarget,
  previousTarget,
  currentJob,
  previousJob
}: {
  currentTarget: LatencyJobTarget | null;
  previousTarget: LatencyJobTarget | null;
  currentJob: LatencyJobDetail | null;
  previousJob: LatencyJobDetail | null;
}) => {
  if (!previousTarget || !previousJob) {
    return 'missing_previous' as const;
  }

  if (!currentTarget || !currentJob) {
    return 'missing_current' as const;
  }

  if (currentTarget.success !== previousTarget.success) {
    return currentTarget.success ? ('improved' as const) : ('regressed' as const);
  }

  if (currentTarget.latencyMs != null && previousTarget.latencyMs != null) {
    if (currentTarget.latencyMs < previousTarget.latencyMs) {
      return 'improved' as const;
    }

    if (currentTarget.latencyMs > previousTarget.latencyMs) {
      return 'regressed' as const;
    }
  }

  return 'unchanged' as const;
};

const isTargetSuccessful = (
  target: Pick<LatencyJobTarget, 'statusCode' | 'errorMessage' | 'status'>
) => {
  if (target.status !== 'succeeded') {
    return false;
  }

  if (target.errorMessage) {
    return false;
  }

  if (target.statusCode == null) {
    return false;
  }

  return target.statusCode >= 200 && target.statusCode < 400;
};
