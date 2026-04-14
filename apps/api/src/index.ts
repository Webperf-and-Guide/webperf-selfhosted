import type {
  AnalysisResource,
  AnalysisListResponse,
  CheckProfileAlertDelivery,
  CheckProfileBaselineResponse,
  CheckProfileComparisonResponse,
  CheckProfile,
  CheckProfileReportResponse,
  CheckProfileLatestComparisonResponse,
  CheckProfileListResponse,
  CheckProfileRun,
  CheckProfileRunDetailResponse,
  CheckProfileRunReportSummary,
  CheckProfileRunListResponse,
  CheckProfileRunResponse,
  CreateCheckProfileInput,
  CreateComparisonInput,
  CreateExportInput,
  CreateAnalysisInput,
  CreateLatencyJobInput,
  CreatePropertyInput,
  CreateRegionPackInput,
  CreateRouteSetInput,
  ComparisonListResponse,
  JobListResponse,
  JobSnapshotEvent,
  LatencyJobDetail,
  LatencyJobTarget,
  ComparisonResource,
  ListQuery,
  Property,
  PropertyListResponse,
  ProbeMeasurementResponse,
  RegionCode,
  RegionPack,
  RegionPackListResponse,
  ReportExportFormat,
  ExportResource,
  ExportListResponse,
  RouteSet,
  RouteSetListResponse,
  SchedulerDispatchResponse,
  SetCheckProfileBaselineInput,
  SignedProbeMeasurementRequest,
  UpdateCheckProfileInput,
  UpdatePropertyInput,
  UpdateRegionPackInput,
  UpdateRouteSetInput
} from '@webperf/contracts';
import {
  analysisListResponseSchema,
  analysisResourceSchema,
  appContract,
  checkProfileListResponseSchema,
  checkProfileRunListResponseSchema,
  comparisonListResponseSchema,
  createAnalysisInputSchema,
  createComparisonInputSchema,
  controlContract,
  createCheckProfileSchema,
  createExportInputSchema,
  createLatencyJobSchema,
  createPropertySchema,
  createRegionPackSchema,
  createRouteSetSchema,
  exportListResponseSchema,
  exportResourceSchema,
  jobListResponseSchema,
  listQuerySchema,
  propertyListResponseSchema,
  comparisonResourceSchema,
  probeMeasurementResponseSchema,
  regionPackListResponseSchema,
  reportExportFormatSchema,
  routeSetListResponseSchema,
  setCheckProfileBaselineSchema,
  signedProbeMeasurementRequestSchema,
  opsContract,
  publicContract,
  updateCheckProfileSchema,
  updatePropertySchema,
  updateRegionPackSchema,
  updateRouteSetSchema
} from '@webperf/contracts';
import { buildControlOpenApiDocument } from '@webperf/contracts/control-openapi';
import { buildPublicOpenApiDocument } from '@webperf/contracts/public-openapi';
import { implement, ORPCError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import {
  applyListQuery,
  buildRegionAvailabilityList,
  createProbeSignature,
  dedupeRegions,
  parseListQueryFromSearchParams,
  resolveRequestedRegions,
  validateMeasurementUrl
} from '@webperf/domain-core';
import { parseSelfhostApiVars } from '@webperf/config/selfhost';
import {
  buildCheckProfileComparison,
  buildCheckProfileReportCsv,
  deriveJobStatus,
  evaluateMonitorTargets,
  summarizeCheckProfileRunReport,
  summarizeTargets
} from '@webperf/report-core';
import { createSqliteJobRepository } from './repository';

type SelfhostRuntime = {
  host: string;
  port: number;
  databasePath: string;
  retentionDays: number;
  probeSharedSecret?: string;
  probeSharedSecretNext?: string;
  activeRegionCodes: RegionCode[];
  regionIds: Partial<Record<RegionCode, string>>;
  probeBaseUrls: Partial<Record<RegionCode, string>>;
  maxTargetAttempts: number;
};

type MutableTarget = LatencyJobTarget;
type MutableJob = LatencyJobDetail;
type CreatedProfileJob = {
  routeId: string;
  routeLabel: string;
  url: string;
  job: MutableJob;
};

const regionCodeSet = new Set<string>([
  'ashburn',
  'atlanta',
  'boston',
  'chicago',
  'dallas',
  'denver',
  'losangeles',
  'miami',
  'newyork',
  'sanjose',
  'seattle',
  'toronto',
  'amsterdam',
  'athens',
  'bucharest',
  'copenhagen',
  'frankfurt',
  'london',
  'madrid',
  'milan',
  'paris',
  'prague',
  'stockholm',
  'vienna',
  'warsaw',
  'zagreb',
  'bangkok',
  'hongkong',
  'istanbul',
  'jakarta',
  'kualalumpur',
  'manila',
  'singapore',
  'telaviv',
  'tokyo',
  'bogota',
  'mexicocity',
  'saopaulo',
  'sydney',
  'johannesburg',
  'lagos'
]);

export const runtime = parseRuntime(process.env);
export const repository = createSqliteJobRepository({
  databasePath: runtime.databasePath
});

repository.pruneJobsOlderThan(runtime.retentionDays);

const buildHealthPayload = () => ({
  service: 'webperf-api',
  ok: true,
  activeRegions: runtime.activeRegionCodes,
  configuredProbeRegions: Object.keys(runtime.probeBaseUrls),
  maxTargetAttempts: runtime.maxTargetAttempts,
  storage: {
    kind: 'sqlite' as const,
    databasePath: runtime.databasePath,
    retainedDays: runtime.retentionDays,
    persistedJobs: repository.countJobs()
  },
  savedConfigs: {
    properties: repository.listProperties().length,
    routeSets: repository.listRouteSets().length,
    regionPacks: repository.listRegionPacks().length,
    checkProfiles: repository.listCheckProfiles().length,
    scheduledProfiles: repository
      .listCheckProfiles()
      .filter((profile) => profile.schedule && profile.schedule.nextRunAt).length
  },
  monitoring: {
    profilesWithAlerts: repository
      .listCheckProfiles()
      .filter((profile) => profile.alerts?.enabled && (profile.alerts.webhookTargets?.length ?? 0) > 0).length,
    profilesWithThresholds: repository
      .listCheckProfiles()
      .filter((profile) => profile.monitorPolicy?.latencyThresholdMs != null).length
  }
});

const buildPublicCapabilitiesPayload = () => ({
  deploymentModel: 'selfhost' as const,
  features: {
    managedRegions: false,
    scheduledChecks: true,
    baselineCompare: true,
    reportExports: true,
    webhookAlerts: true,
    aiAnalyses: false,
    openApi: true,
    appRpc: true,
    opsRpc: true
  }
});

const buildPropertyListResponse = (query?: ListQuery): PropertyListResponse =>
  propertyListResponseSchema.parse({
    properties: applyListQuery(repository.listProperties(), query, (property) => [
      property.id,
      property.name,
      property.baseUrl
    ]).items,
    pageInfo: applyListQuery(repository.listProperties(), query, (property) => [
      property.id,
      property.name,
      property.baseUrl
    ]).pageInfo
  });

const buildRouteSetListResponse = (query?: ListQuery): RouteSetListResponse =>
  routeSetListResponseSchema.parse({
    routeSets: applyListQuery(repository.listRouteSets(), query, (routeSet) => [
      routeSet.id,
      routeSet.propertyId,
      routeSet.name,
      ...routeSet.routes.flatMap((route) => [route.id, route.label, route.url])
    ]).items,
    pageInfo: applyListQuery(repository.listRouteSets(), query, (routeSet) => [
      routeSet.id,
      routeSet.propertyId,
      routeSet.name,
      ...routeSet.routes.flatMap((route) => [route.id, route.label, route.url])
    ]).pageInfo
  });

const buildRegionPackListResponse = (query?: ListQuery): RegionPackListResponse =>
  regionPackListResponseSchema.parse({
    regionPacks: applyListQuery(repository.listRegionPacks(), query, (regionPack) => [
      regionPack.id,
      regionPack.name,
      ...regionPack.regions
    ]).items,
    pageInfo: applyListQuery(repository.listRegionPacks(), query, (regionPack) => [
      regionPack.id,
      regionPack.name,
      ...regionPack.regions
    ]).pageInfo
  });

const buildCheckProfileListResponse = (query?: ListQuery): CheckProfileListResponse =>
  checkProfileListResponseSchema.parse({
    checkProfiles: applyListQuery(repository.listCheckProfiles(), query, (profile) => [
      profile.id,
      profile.name,
      profile.note,
      profile.propertyId,
      profile.routeSetId,
      profile.regionPackId
    ]).items,
    pageInfo: applyListQuery(repository.listCheckProfiles(), query, (profile) => [
      profile.id,
      profile.name,
      profile.note,
      profile.propertyId,
      profile.routeSetId,
      profile.regionPackId
    ]).pageInfo
  });

const buildJobListResponse = (query?: ListQuery): JobListResponse =>
  jobListResponseSchema.parse({
    jobs: applyListQuery(repository.listJobs(), query, (job) => [
      job.id,
      job.url,
      job.status,
      job.note,
      job.requesterIp,
      ...job.selectedRegions
    ]).items,
    pageInfo: applyListQuery(repository.listJobs(), query, (job) => [
      job.id,
      job.url,
      job.status,
      job.note,
      job.requesterIp,
      ...job.selectedRegions
    ]).pageInfo
  });

const buildCheckProfileRunListResponse = (profileId: string, query?: ListQuery): CheckProfileRunListResponse =>
  checkProfileRunListResponseSchema.parse({
    runs: applyListQuery(repository.listCheckProfileRuns(profileId), query, (run) => [
      run.id,
      run.profileId,
      run.trigger,
      run.createdAt,
      run.evaluation?.status
    ]).items,
    pageInfo: applyListQuery(repository.listCheckProfileRuns(profileId), query, (run) => [
      run.id,
      run.profileId,
      run.trigger,
      run.createdAt,
      run.evaluation?.status
    ]).pageInfo
  });

const buildComparisonListResponse = (query?: ListQuery): ComparisonListResponse =>
  comparisonListResponseSchema.parse({
    comparisons: applyListQuery(repository.listComparisons(), query, (comparison) => [
      comparison.id,
      comparison.checkId,
      comparison.currentRun.id,
      comparison.comparedRun?.id,
      comparison.mode
    ]).items,
    pageInfo: applyListQuery(repository.listComparisons(), query, (comparison) => [
      comparison.id,
      comparison.checkId,
      comparison.currentRun.id,
      comparison.comparedRun?.id,
      comparison.mode
    ]).pageInfo
  });

const buildExportListResponse = (query?: ListQuery): ExportListResponse =>
  exportListResponseSchema.parse({
    exports: applyListQuery(repository.listExports(), query, (exportResource) => [
      exportResource.id,
      exportResource.source.type,
      'checkId' in exportResource.source ? exportResource.source.checkId : null,
      'comparisonId' in exportResource.source ? exportResource.source.comparisonId : null,
      exportResource.format,
      exportResource.status,
      exportResource.filename
    ]).items,
    pageInfo: applyListQuery(repository.listExports(), query, (exportResource) => [
      exportResource.id,
      exportResource.source.type,
      'checkId' in exportResource.source ? exportResource.source.checkId : null,
      'comparisonId' in exportResource.source ? exportResource.source.comparisonId : null,
      exportResource.format,
      exportResource.status,
      exportResource.filename
    ]).pageInfo
  });

const buildAnalysisListResponse = (query?: ListQuery): AnalysisListResponse =>
  analysisListResponseSchema.parse({
    analyses: applyListQuery(repository.listAnalyses(), query, (analysis) => [
      analysis.id,
      analysis.kind,
      analysis.status,
      analysis.source.type,
      'checkId' in analysis.source ? analysis.source.checkId : null,
      'runId' in analysis.source ? analysis.source.runId : null,
      'comparisonId' in analysis.source ? analysis.source.comparisonId : null,
      analysis.output.narrative
    ]).items,
    pageInfo: applyListQuery(repository.listAnalyses(), query, (analysis) => [
      analysis.id,
      analysis.kind,
      analysis.status,
      analysis.source.type,
      'checkId' in analysis.source ? analysis.source.checkId : null,
      'runId' in analysis.source ? analysis.source.runId : null,
      'comparisonId' in analysis.source ? analysis.source.comparisonId : null,
      analysis.output.narrative
    ]).pageInfo
  });

const toSitesPayload = (query?: ListQuery) => {
  const payload = buildPropertyListResponse(query);
  return {
    sites: payload.properties,
    pageInfo: payload.pageInfo
  };
};

const toRouteGroupsPayload = (query?: ListQuery) => {
  const payload = buildRouteSetListResponse(query);
  return {
    routeGroups: payload.routeSets,
    pageInfo: payload.pageInfo
  };
};

const toRegionSetsPayload = (query?: ListQuery) => {
  const payload = buildRegionPackListResponse(query);
  return {
    regionSets: payload.regionPacks,
    pageInfo: payload.pageInfo
  };
};

const toChecksPayload = (query?: ListQuery) => {
  const payload = buildCheckProfileListResponse(query);
  return {
    checks: payload.checkProfiles,
    pageInfo: payload.pageInfo
  };
};

const buildRunDetailById = (runId: string) => {
  const run = repository.getCheckProfileRun(runId);

  if (!run) {
    return null;
  }

  const profile = repository.getCheckProfile(run.profileId);

  if (!profile) {
    return null;
  }

  const jobs = run.routes
    .map((route) => repository.getJob(route.jobId))
    .filter((job): job is LatencyJobDetail => job !== null);

  return {
    profile,
    run,
    jobs
  };
};

const buildComparisonResource = (input: CreateComparisonInput): ComparisonResource => {
  const detail = buildRunDetailById(input.runId);

  if (!detail || detail.profile.id !== input.checkId) {
    throw new ORPCError('NOT_FOUND', { message: 'Run not found for check' });
  }

  let comparedRun: CheckProfileRun | null = null;
  let mode: ComparisonResource['mode'] = 'latest_previous';

  if (input.target.type === 'baseline') {
    mode = 'baseline';
    comparedRun = resolveBaselineRun(detail.profile);
  } else if (input.target.type === 'run') {
    mode = 'custom';
    const candidate = repository.getCheckProfileRun(input.target.runId);
    if (candidate?.profileId === detail.profile.id) {
      comparedRun = candidate;
    }
  } else {
    mode = 'latest_previous';
    comparedRun = findPreviousRun(detail.profile.id, detail.run.id);
  }

  const comparison = buildProfileComparisonResponse(detail.profile, detail.run, comparedRun, mode);
  const resource: ComparisonResource = comparisonResourceSchema.parse({
    id: `cmp_${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
    checkId: detail.profile.id,
    currentRun: comparison.currentRun,
    comparedRun: comparison.comparedRun,
    mode: comparison.mode,
    summary: comparison.summary,
    routes: comparison.routes
  });

  repository.saveComparison(resource);
  return resource;
};

const buildExportResource = (input: CreateExportInput): ExportResource => {
  const createdAt = new Date().toISOString();

  if (input.source.type === 'comparison') {
    const comparison = repository.getComparison(input.source.comparisonId);
    if (!comparison) {
      throw new ORPCError('NOT_FOUND', { message: 'Comparison not found' });
    }

    const body =
      input.format === 'csv'
        ? [
            'routeId,routeLabel,region,classification,latencyDeltaMs,latencyDeltaPct',
            ...comparison.routes.flatMap((route) =>
              route.regions.map((region) =>
                [
                  route.routeId,
                  JSON.stringify(route.routeLabel),
                  region.region,
                  region.classification,
                  region.latencyDeltaMs ?? '',
                  region.latencyDeltaPct ?? ''
                ].join(',')
              )
            )
          ].join('\n')
        : JSON.stringify(comparison, null, 2);

    const exportResource = exportResourceSchema.parse({
      id: `exp_${crypto.randomUUID()}`,
      createdAt,
      source: input.source,
      format: input.format,
      status: 'succeeded',
      filename: `${comparison.checkId}-${comparison.id}.${input.format === 'csv' ? 'csv' : 'json'}`,
      contentType: input.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      body
    });

    repository.saveExport(exportResource);
    return exportResource;
  }

  const profile = repository.getCheckProfile(input.source.checkId);
  if (!profile) {
    throw new ORPCError('NOT_FOUND', { message: 'Check not found' });
  }

  const report = buildCheckProfileReport(profile);
  const body =
    input.format === 'csv'
      ? buildCheckProfileReportCsv({
          profile,
          runs: report.recentRuns
        })
      : JSON.stringify(report, null, 2);

  const exportResource = exportResourceSchema.parse({
    id: `exp_${crypto.randomUUID()}`,
    createdAt,
    source: input.source,
    format: input.format,
    status: 'succeeded',
    filename: `${profile.id}-report.${input.format === 'csv' ? 'csv' : 'json'}`,
    contentType: input.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
    body
  });

  repository.saveExport(exportResource);
  return exportResource;
};

const buildAnalysisResource = (input: CreateAnalysisInput): AnalysisResource => {
  let comparison: ComparisonResource;

  if (input.source.type === 'comparison') {
    const existing = repository.getComparison(input.source.comparisonId);
    if (!existing) {
      throw new ORPCError('NOT_FOUND', { message: 'Comparison not found' });
    }
    comparison = existing;
  } else {
    comparison = buildComparisonResource({
      checkId: input.source.checkId,
      runId: input.source.runId,
      target: { type: 'latest_previous' }
    });
  }

  const findings = [];
  const recommendations = [];

  if (comparison.summary.regressed > 0) {
    findings.push({
      id: `finding_${crypto.randomUUID()}`,
      kind: 'latency_regression',
      severity: comparison.summary.regressed >= 3 ? 'high' : 'medium',
      summary: `${comparison.summary.regressed} region checks regressed`,
      evidenceRefs: [comparison.id]
    });
    recommendations.push({
      id: `rec_${crypto.randomUUID()}`,
      kind: 'inspect_regressed_routes',
      summary: 'Inspect the regressed routes and review route-level artifacts before changing baselines.'
    });
  }

  if (comparison.summary.missingCurrent > 0 || comparison.summary.missingPrevious > 0) {
    findings.push({
      id: `finding_${crypto.randomUUID()}`,
      kind: 'coverage_gap',
      severity: 'low',
      summary: 'Some route-region comparisons are missing one side of the measurement.',
      evidenceRefs: [comparison.id]
    });
  }

  const analysis = analysisResourceSchema.parse({
    id: `anl_${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
    source: input.source,
    kind: input.kind,
    status: 'succeeded',
    output: {
      findings,
      recommendations,
      narrative:
        findings.length > 0
          ? `Comparison ${comparison.id} contains ${comparison.summary.regressed} regressed region checks and ${comparison.summary.improved} improvements.`
          : 'No meaningful regressions were detected in the current comparison.'
    },
    generator: {
      type: 'rule_engine',
      version: 'v1'
    }
  });

  repository.saveAnalysis(analysis);
  return analysis;
};

const createJobSnapshotStream = (jobId: string) => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const sendSnapshot = async () => {
        for (let i = 0; i < 60; i += 1) {
          const job = repository.getJob(jobId);

          if (!job) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Job not found' })}\n\n`));
            break;
          }

          const payload: JobSnapshotEvent = {
            type: 'job.snapshot',
            job
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

          if (job.summary.inflight === 0) {
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        controller.close();
      };

      void sendSnapshot();
    }
  });
};

export const server = Bun.serve({
  hostname: runtime.host,
  port: runtime.port,
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === '/openapi/control.json' && request.method === 'GET') {
      return json(await getControlOpenApiDocument());
    }

    if (pathname === '/openapi/public.json' && request.method === 'GET') {
      return json(await getPublicOpenApiDocument());
    }

    if (pathname.startsWith('/rpc')) {
      const handler =
        pathname.startsWith('/rpc/public')
          ? publicRpcHandler
          : pathname.startsWith('/rpc/app')
            ? appRpcHandler
            : pathname.startsWith('/rpc/ops')
              ? opsRpcHandler
              : controlRpcHandler;
      const prefix =
        pathname.startsWith('/rpc/public')
          ? '/rpc/public'
          : pathname.startsWith('/rpc/app')
            ? '/rpc/app'
            : pathname.startsWith('/rpc/ops')
              ? '/rpc/ops'
              : '/rpc';
      const result = await handler.handle(request, {
        prefix,
        context: { request }
      } as never);

      if (result.matched) {
        return result.response;
      }
    }

    if (pathname === '/health' || pathname === '/v1/health') {
      return json(buildHealthPayload());
    }

    if (pathname === '/v1/regions' && request.method === 'GET') {
      return json({
        regions: getRegionAvailability()
      });
    }

    if (pathname === '/v1/capabilities' && request.method === 'GET') {
      return json(buildPublicCapabilitiesPayload());
    }

    if (pathname === '/v1/jobs' && request.method === 'GET') {
      return json(buildJobListResponse(parseListQueryFromSearchParams(url.searchParams)));
    }

    if (pathname === '/v1/jobs' && request.method === 'POST') {
      return handleCreateJob(request);
    }

    if (pathname === '/v1/properties' && request.method === 'GET') {
      return json(buildPropertyListResponse(parseListQueryFromSearchParams(url.searchParams)));
    }

    if (pathname === '/v1/properties' && request.method === 'POST') {
      return handleCreateProperty(request);
    }

    if (pathname === '/v1/sites' && request.method === 'GET') {
      return json(toSitesPayload(parseListQueryFromSearchParams(url.searchParams)));
    }

    if (pathname === '/v1/sites' && request.method === 'POST') {
      const response = await handleCreateProperty(request);
      const payload = await readResponsePayload(response);

      if (!response.ok) {
        return json(payload, { status: response.status });
      }

      return json({ site: (payload as { property: Property }).property }, { status: response.status });
    }

    if (pathname === '/v1/route-sets' && request.method === 'GET') {
      return json(buildRouteSetListResponse(parseListQueryFromSearchParams(url.searchParams)));
    }

    if (pathname === '/v1/route-sets' && request.method === 'POST') {
      return handleCreateRouteSet(request);
    }

    if (pathname === '/v1/route-groups' && request.method === 'GET') {
      return json(toRouteGroupsPayload(parseListQueryFromSearchParams(url.searchParams)));
    }

    if (pathname === '/v1/route-groups' && request.method === 'POST') {
      const response = await handleCreateRouteSet(request);
      const payload = await readResponsePayload(response);

      if (!response.ok) {
        return json(payload, { status: response.status });
      }

      return json({ routeGroup: (payload as { routeSet: RouteSet }).routeSet }, { status: response.status });
    }

    if (pathname === '/v1/region-packs' && request.method === 'GET') {
      return json(buildRegionPackListResponse(parseListQueryFromSearchParams(url.searchParams)));
    }

    if (pathname === '/v1/region-packs' && request.method === 'POST') {
      return handleCreateRegionPack(request);
    }

    if (pathname === '/v1/region-sets' && request.method === 'GET') {
      return json(toRegionSetsPayload(parseListQueryFromSearchParams(url.searchParams)));
    }

    if (pathname === '/v1/region-sets' && request.method === 'POST') {
      const response = await handleCreateRegionPack(request);
      const payload = await readResponsePayload(response);

      if (!response.ok) {
        return json(payload, { status: response.status });
      }

      return json({ regionSet: (payload as { regionPack: RegionPack }).regionPack }, { status: response.status });
    }

    if (pathname === '/v1/check-profiles' && request.method === 'GET') {
      return json(buildCheckProfileListResponse(parseListQueryFromSearchParams(url.searchParams)));
    }

    if (pathname === '/v1/check-profiles' && request.method === 'POST') {
      return handleCreateCheckProfile(request);
    }

    if (pathname === '/v1/checks' && request.method === 'GET') {
      return json(toChecksPayload(parseListQueryFromSearchParams(url.searchParams)));
    }

    if (pathname === '/v1/checks' && request.method === 'POST') {
      const response = await handleCreateCheckProfile(request);
      const payload = await readResponsePayload(response);

      if (!response.ok) {
        return json(payload, { status: response.status });
      }

      return json({ check: (payload as { profile: CheckProfile }).profile }, { status: response.status });
    }

    if (pathname === '/v1/comparisons' && request.method === 'GET') {
      return json(buildComparisonListResponse(parseListQueryFromSearchParams(url.searchParams)));
    }

    if (pathname === '/v1/comparisons' && request.method === 'POST') {
      const body = await parseJsonBody<CreateComparisonInput>(request);

      if (!body.ok) {
        return body.response;
      }

      const parsed = createComparisonInputSchema.safeParse(body.data);
      if (!parsed.success) {
        return json({ error: 'Invalid comparison payload', issues: parsed.error.flatten() }, { status: 400 });
      }

      try {
        return json(buildComparisonResource(parsed.data), { status: 201 });
      } catch (error) {
        return toJsonError(error);
      }
    }

    if (pathname === '/v1/exports' && request.method === 'GET') {
      return json(buildExportListResponse(parseListQueryFromSearchParams(url.searchParams)));
    }

    if (pathname === '/v1/exports' && request.method === 'POST') {
      const body = await parseJsonBody<CreateExportInput>(request);

      if (!body.ok) {
        return body.response;
      }

      const parsed = createExportInputSchema.safeParse(body.data);
      if (!parsed.success) {
        return json({ error: 'Invalid export payload', issues: parsed.error.flatten() }, { status: 400 });
      }

      try {
        return json(buildExportResource(parsed.data), { status: 201 });
      } catch (error) {
        return toJsonError(error);
      }
    }

    if (pathname === '/v1/analyses' && request.method === 'GET') {
      return json(buildAnalysisListResponse(parseListQueryFromSearchParams(url.searchParams)));
    }

    if (pathname === '/v1/analyses' && request.method === 'POST') {
      const body = await parseJsonBody<CreateAnalysisInput>(request);

      if (!body.ok) {
        return body.response;
      }

      const parsed = createAnalysisInputSchema.safeParse(body.data);
      if (!parsed.success) {
        return json({ error: 'Invalid analysis payload', issues: parsed.error.flatten() }, { status: 400 });
      }

      try {
        return json(buildAnalysisResource(parsed.data), { status: 201 });
      } catch (error) {
        return toJsonError(error);
      }
    }

    if (pathname === '/v1/scheduler/dispatch' && request.method === 'POST') {
      return handleDispatchScheduledProfiles(request, url);
    }

    const propertyMatch = pathname.match(/^\/v1\/properties\/([^/]+)$/);
    if (propertyMatch?.[1]) {
      if (request.method === 'GET') {
        const property = repository.getProperty(propertyMatch[1]);
        return property ? json(property) : json({ error: 'Property not found' }, { status: 404 });
      }

      if (request.method === 'PUT') {
        return handleUpdateProperty(propertyMatch[1], request);
      }

      if (request.method === 'DELETE') {
        return handleDeleteProperty(propertyMatch[1]);
      }
    }

    const siteMatch = pathname.match(/^\/v1\/sites\/([^/]+)$/);
    if (siteMatch?.[1]) {
      if (request.method === 'GET') {
        const site = repository.getProperty(siteMatch[1]);
        return site ? json(site) : json({ error: 'Site not found' }, { status: 404 });
      }

      if (request.method === 'PATCH') {
        const response = await handleUpdateProperty(siteMatch[1], request);
        const payload = await readResponsePayload(response);

        if (!response.ok) {
          return json(payload, { status: response.status });
        }

        return json({ site: (payload as { property: Property }).property }, { status: response.status });
      }

      if (request.method === 'DELETE') {
        return handleDeleteProperty(siteMatch[1]);
      }
    }

    const routeSetMatch = pathname.match(/^\/v1\/route-sets\/([^/]+)$/);
    if (routeSetMatch?.[1]) {
      if (request.method === 'GET') {
        const routeSet = repository.getRouteSet(routeSetMatch[1]);
        return routeSet ? json(routeSet) : json({ error: 'Route set not found' }, { status: 404 });
      }

      if (request.method === 'PUT') {
        return handleUpdateRouteSet(routeSetMatch[1], request);
      }

      if (request.method === 'DELETE') {
        return handleDeleteRouteSet(routeSetMatch[1]);
      }
    }

    const routeGroupMatch = pathname.match(/^\/v1\/route-groups\/([^/]+)$/);
    if (routeGroupMatch?.[1]) {
      if (request.method === 'GET') {
        const routeGroup = repository.getRouteSet(routeGroupMatch[1]);
        return routeGroup ? json(routeGroup) : json({ error: 'Route group not found' }, { status: 404 });
      }

      if (request.method === 'PATCH') {
        const response = await handleUpdateRouteSet(routeGroupMatch[1], request);
        const payload = await readResponsePayload(response);

        if (!response.ok) {
          return json(payload, { status: response.status });
        }

        return json({ routeGroup: (payload as { routeSet: RouteSet }).routeSet }, { status: response.status });
      }

      if (request.method === 'DELETE') {
        return handleDeleteRouteSet(routeGroupMatch[1]);
      }
    }

    const regionPackMatch = pathname.match(/^\/v1\/region-packs\/([^/]+)$/);
    if (regionPackMatch?.[1]) {
      if (request.method === 'GET') {
        const regionPack = repository.getRegionPack(regionPackMatch[1]);
        return regionPack ? json(regionPack) : json({ error: 'Region pack not found' }, { status: 404 });
      }

      if (request.method === 'PUT') {
        return handleUpdateRegionPack(regionPackMatch[1], request);
      }

      if (request.method === 'DELETE') {
        return handleDeleteRegionPack(regionPackMatch[1]);
      }
    }

    const regionSetMatch = pathname.match(/^\/v1\/region-sets\/([^/]+)$/);
    if (regionSetMatch?.[1]) {
      if (request.method === 'GET') {
        const regionSet = repository.getRegionPack(regionSetMatch[1]);
        return regionSet ? json(regionSet) : json({ error: 'Region set not found' }, { status: 404 });
      }

      if (request.method === 'PATCH') {
        const response = await handleUpdateRegionPack(regionSetMatch[1], request);
        const payload = await readResponsePayload(response);

        if (!response.ok) {
          return json(payload, { status: response.status });
        }

        return json({ regionSet: (payload as { regionPack: RegionPack }).regionPack }, { status: response.status });
      }

      if (request.method === 'DELETE') {
        return handleDeleteRegionPack(regionSetMatch[1]);
      }
    }

    const checkProfileBaselineMatch = pathname.match(/^\/v1\/check-profiles\/([^/]+)\/baseline$/);
    if (checkProfileBaselineMatch?.[1]) {
      if (request.method === 'GET') {
        return handleGetCheckProfileBaseline(checkProfileBaselineMatch[1]);
      }

      if (request.method === 'PUT') {
        return handleSetCheckProfileBaseline(checkProfileBaselineMatch[1], request);
      }

      if (request.method === 'DELETE') {
        return handleClearCheckProfileBaseline(checkProfileBaselineMatch[1]);
      }
    }

    const checkBaselineMatch = pathname.match(/^\/v1\/checks\/([^/]+)\/baseline$/);
    if (checkBaselineMatch?.[1]) {
      if (request.method === 'GET') {
        const response = await handleGetCheckProfileBaseline(checkBaselineMatch[1]);
        const payload = await readResponsePayload(response);

        if (!response.ok) {
          return json(payload, { status: response.status });
        }

        return json({
          check: (payload as CheckProfileBaselineResponse).profile,
          baselineRun: (payload as CheckProfileBaselineResponse).baselineRun
        });
      }

      if (request.method === 'PUT') {
        const response = await handleSetCheckProfileBaseline(checkBaselineMatch[1], request);
        const payload = await readResponsePayload(response);

        if (!response.ok) {
          return json(payload, { status: response.status });
        }

        return json({
          check: (payload as CheckProfileBaselineResponse).profile,
          baselineRun: (payload as CheckProfileBaselineResponse).baselineRun
        });
      }

      if (request.method === 'DELETE') {
        const response = await handleClearCheckProfileBaseline(checkBaselineMatch[1]);
        const payload = await readResponsePayload(response);

        if (!response.ok) {
          return json(payload, { status: response.status });
        }

        return json({
          check: (payload as CheckProfileBaselineResponse).profile,
          baselineRun: (payload as CheckProfileBaselineResponse).baselineRun
        });
      }
    }

    const checkProfileRunMatch = pathname.match(/^\/v1\/check-profiles\/([^/]+)\/runs$/);
    if (checkProfileRunMatch?.[1]) {
      if (request.method === 'GET') {
        return handleListCheckProfileRuns(
          checkProfileRunMatch[1],
          parseListQueryFromSearchParams(url.searchParams)
        );
      }

      if (request.method === 'POST') {
        return handleRunCheckProfile(checkProfileRunMatch[1], request);
      }
    }

    const checkRunMatch = pathname.match(/^\/v1\/checks\/([^/]+)\/runs$/);
    if (checkRunMatch?.[1]) {
      if (request.method === 'GET') {
        const profile = repository.getCheckProfile(checkRunMatch[1]);

        if (!profile) {
          return json({ error: 'Check not found' }, { status: 404 });
        }

        return json(buildCheckProfileRunListResponse(profile.id, parseListQueryFromSearchParams(url.searchParams)));
      }

      if (request.method === 'POST') {
        const response = await handleRunCheckProfile(checkRunMatch[1], request);
        const payload = await readResponsePayload(response);

        if (!response.ok) {
          return json(payload, { status: response.status });
        }

        return json({
          check: (payload as CheckProfileRunResponse).profile,
          jobs: (payload as CheckProfileRunResponse).jobs
        }, { status: response.status });
      }
    }

    const checkProfileRunDetailMatch = pathname.match(/^\/v1\/check-profiles\/([^/]+)\/runs\/([^/]+)$/);
    if (checkProfileRunDetailMatch?.[1] && checkProfileRunDetailMatch?.[2] && request.method === 'GET') {
      return handleGetCheckProfileRun(checkProfileRunDetailMatch[1], checkProfileRunDetailMatch[2]);
    }

    const checkProfileRunComparisonMatch = pathname.match(/^\/v1\/check-profiles\/([^/]+)\/runs\/([^/]+)\/compare$/);
    if (
      checkProfileRunComparisonMatch?.[1] &&
      checkProfileRunComparisonMatch?.[2] &&
      request.method === 'GET'
    ) {
      return handleGetCheckProfileRunComparison(
        checkProfileRunComparisonMatch[1],
        checkProfileRunComparisonMatch[2],
        url
      );
    }

    const latestComparisonMatch = pathname.match(/^\/v1\/check-profiles\/([^/]+)\/compare\/latest$/);
    if (latestComparisonMatch?.[1] && request.method === 'GET') {
      return handleGetLatestCheckProfileComparison(latestComparisonMatch[1]);
    }

    const baselineComparisonMatch = pathname.match(/^\/v1\/check-profiles\/([^/]+)\/compare\/baseline$/);
    if (baselineComparisonMatch?.[1] && request.method === 'GET') {
      return handleGetBaselineCheckProfileComparison(baselineComparisonMatch[1]);
    }

    const reportExportMatch = pathname.match(/^\/v1\/check-profiles\/([^/]+)\/report\/export$/);
    if (reportExportMatch?.[1] && request.method === 'GET') {
      return handleExportCheckProfileReport(reportExportMatch[1], url);
    }

    const reportMatch = pathname.match(/^\/v1\/check-profiles\/([^/]+)\/report$/);
    if (reportMatch?.[1] && request.method === 'GET') {
      return handleGetCheckProfileReport(reportMatch[1]);
    }

    const checkProfileMatch = pathname.match(/^\/v1\/check-profiles\/([^/]+)$/);
    if (checkProfileMatch?.[1]) {
      if (request.method === 'GET') {
        const checkProfile = repository.getCheckProfile(checkProfileMatch[1]);
        return checkProfile
          ? json(checkProfile)
          : json({ error: 'Check profile not found' }, { status: 404 });
      }

      if (request.method === 'PUT') {
        return handleUpdateCheckProfile(checkProfileMatch[1], request);
      }

      if (request.method === 'DELETE') {
        return handleDeleteCheckProfile(checkProfileMatch[1]);
      }
    }

    const checkMatch = pathname.match(/^\/v1\/checks\/([^/]+)$/);
    if (checkMatch?.[1]) {
      if (request.method === 'GET') {
        const check = repository.getCheckProfile(checkMatch[1]);
        return check ? json(check) : json({ error: 'Check not found' }, { status: 404 });
      }

      if (request.method === 'PATCH') {
        const response = await handleUpdateCheckProfile(checkMatch[1], request);
        const payload = await readResponsePayload(response);

        if (!response.ok) {
          return json(payload, { status: response.status });
        }

        return json({ check: (payload as { profile: CheckProfile }).profile }, { status: response.status });
      }

      if (request.method === 'DELETE') {
        const response = await handleDeleteCheckProfile(checkMatch[1]);
        const payload = await readResponsePayload(response);

        if (!response.ok) {
          return json(payload, { status: response.status });
        }

        return json(payload, { status: response.status });
      }
    }

    const jobStreamMatch = pathname.match(/^\/v1\/jobs\/([^/]+)\/stream$/);
    if (jobStreamMatch?.[1] && request.method === 'GET') {
      return handleJobStream(jobStreamMatch[1]);
    }

    const jobMatch = pathname.match(/^\/v1\/jobs\/([^/]+)$/);
    if (jobMatch?.[1] && request.method === 'GET') {
      const job = repository.getJob(jobMatch[1]);
      return job ? json(job) : json({ error: 'Job not found' }, { status: 404 });
    }

    const runMatch = pathname.match(/^\/v1\/runs\/([^/]+)$/);
    if (runMatch?.[1] && request.method === 'GET') {
      const detail = buildRunDetailById(runMatch[1]);

      if (!detail) {
        return json({ error: 'Run not found' }, { status: 404 });
      }

      return json({
        check: detail.profile,
        run: detail.run,
        jobs: detail.jobs
      });
    }

    const comparisonMatch = pathname.match(/^\/v1\/comparisons\/([^/]+)$/);
    if (comparisonMatch?.[1] && request.method === 'GET') {
      const comparison = repository.getComparison(comparisonMatch[1]);
      return comparison ? json(comparison) : json({ error: 'Comparison not found' }, { status: 404 });
    }

    const exportMatch = pathname.match(/^\/v1\/exports\/([^/]+)$/);
    if (exportMatch?.[1] && request.method === 'GET') {
      const exportResource = repository.getExport(exportMatch[1]);
      return exportResource ? json(exportResource) : json({ error: 'Export not found' }, { status: 404 });
    }

    const analysisMatch = pathname.match(/^\/v1\/analyses\/([^/]+)$/);
    if (analysisMatch?.[1] && request.method === 'GET') {
      const analysis = repository.getAnalysis(analysisMatch[1]);
      return analysis ? json(analysis) : json({ error: 'Analysis not found' }, { status: 404 });
    }

    return json(
      {
        ok: false,
        message:
          'Use /health, /v1/regions, /v1/jobs, /v1/properties, /v1/route-sets, /v1/region-packs, /v1/check-profiles, or their detail routes'
      },
      { status: 404 }
    );
  }
});

console.log(
  JSON.stringify({
    service: 'webperf-api',
    listeningOn: `http://${runtime.host}:${runtime.port}`,
    activeRegions: runtime.activeRegionCodes,
    databasePath: runtime.databasePath,
    retainedDays: runtime.retentionDays
  })
);

async function handleCreateJob(request: Request) {
  const body = await parseJsonBody<CreateLatencyJobInput>(request);

  if (!body.ok) {
    return body.response;
  }

  const parsed = createLatencyJobSchema.safeParse(body.data);

  if (!parsed.success) {
    return json(
      {
        error: 'Invalid create job payload',
        issues: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  let job: MutableJob;

  try {
    job = createJobRecord({
      url: parsed.data.url,
      regions: parsed.data.regions,
      note: parsed.data.note ?? null,
      requestConfig: normalizeCustomRequestConfig(parsed.data.request),
      monitorPolicy: normalizeMonitorPolicy(parsed.data.monitorPolicy),
      requesterIp: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? null
    });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Failed to create job'
      },
      { status: 400 }
    );
  }

  void processJob(job.id);

  return json(
    {
      job
    },
    { status: 201 }
  );
}

async function handleCreateProperty(request: Request) {
  return handleUpsertProperty(request);
}

async function handleCreateRouteSet(request: Request) {
  return handleUpsertRouteSet(request);
}

async function handleCreateRegionPack(request: Request) {
  return handleUpsertRegionPack(request);
}

async function handleCreateCheckProfile(request: Request) {
  return handleUpsertCheckProfile(request);
}

async function handleUpdateProperty(propertyId: string, request: Request) {
  const property = repository.getProperty(propertyId);

  if (!property) {
    return json({ error: 'Property not found' }, { status: 404 });
  }

  return handleUpsertProperty(request, property);
}

async function handleUpdateRouteSet(routeSetId: string, request: Request) {
  const routeSet = repository.getRouteSet(routeSetId);

  if (!routeSet) {
    return json({ error: 'Route set not found' }, { status: 404 });
  }

  return handleUpsertRouteSet(request, routeSet);
}

async function handleUpdateRegionPack(regionPackId: string, request: Request) {
  const regionPack = repository.getRegionPack(regionPackId);

  if (!regionPack) {
    return json({ error: 'Region pack not found' }, { status: 404 });
  }

  return handleUpsertRegionPack(request, regionPack);
}

async function handleUpdateCheckProfile(profileId: string, request: Request) {
  const profile = repository.getCheckProfile(profileId);

  if (!profile) {
    return json({ error: 'Check profile not found' }, { status: 404 });
  }

  return handleUpsertCheckProfile(request, profile);
}

function handleDeleteProperty(propertyId: string) {
  const property = repository.getProperty(propertyId);

  if (!property) {
    return json({ error: 'Property not found' }, { status: 404 });
  }

  const dependentRouteSets = repository.listRouteSets().filter((routeSet) => routeSet.propertyId === property.id);
  const dependentProfiles = repository.listCheckProfiles().filter((profile) => profile.propertyId === property.id);

  if (dependentRouteSets.length > 0 || dependentProfiles.length > 0) {
    return json(
      {
        error: 'Delete route sets and check profiles that depend on this property first.',
        dependencies: {
          routeSets: dependentRouteSets.length,
          checkProfiles: dependentProfiles.length
        }
      },
      { status: 409 }
    );
  }

  repository.deleteProperty(property.id);
  return json({ ok: true }, { status: 200 });
}

function handleDeleteRouteSet(routeSetId: string) {
  const routeSet = repository.getRouteSet(routeSetId);

  if (!routeSet) {
    return json({ error: 'Route set not found' }, { status: 404 });
  }

  const dependentProfiles = repository.listCheckProfiles().filter((profile) => profile.routeSetId === routeSet.id);

  if (dependentProfiles.length > 0) {
    return json(
      {
        error: 'Delete or reassign check profiles that use this route set first.',
        dependencies: {
          checkProfiles: dependentProfiles.length
        }
      },
      { status: 409 }
    );
  }

  repository.deleteRouteSet(routeSet.id);
  return json({ ok: true }, { status: 200 });
}

function handleDeleteRegionPack(regionPackId: string) {
  const regionPack = repository.getRegionPack(regionPackId);

  if (!regionPack) {
    return json({ error: 'Region pack not found' }, { status: 404 });
  }

  const dependentProfiles = repository.listCheckProfiles().filter((profile) => profile.regionPackId === regionPack.id);

  if (dependentProfiles.length > 0) {
    return json(
      {
        error: 'Delete or reassign check profiles that use this region pack first.',
        dependencies: {
          checkProfiles: dependentProfiles.length
        }
      },
      { status: 409 }
    );
  }

  repository.deleteRegionPack(regionPack.id);
  return json({ ok: true }, { status: 200 });
}

function handleDeleteCheckProfile(profileId: string) {
  const profile = repository.getCheckProfile(profileId);

  if (!profile) {
    return json({ error: 'Check profile not found' }, { status: 404 });
  }

  const result = repository.deleteCheckProfile(profile.id);

  return json(
    {
      ok: result.deleted,
      deletedRunCount: result.deletedRunCount
    },
    { status: 200 }
  );
}

function handleGetCheckProfileBaseline(profileId: string) {
  const profile = repository.getCheckProfile(profileId);

  if (!profile) {
    return json({ error: 'Check profile not found' }, { status: 404 });
  }

  const baselineRun =
    profile.baseline?.runId != null ? repository.getCheckProfileRun(profile.baseline.runId) : null;

  const payload: CheckProfileBaselineResponse = {
    profile: baselineRun ? profile : { ...profile, baseline: null },
    baselineRun: baselineRun && baselineRun.profileId === profile.id ? baselineRun : null
  };

  return json(payload, { status: 200 });
}

async function handleSetCheckProfileBaseline(profileId: string, request: Request) {
  const profile = repository.getCheckProfile(profileId);

  if (!profile) {
    return json({ error: 'Check profile not found' }, { status: 404 });
  }

  const body = await parseJsonBody<SetCheckProfileBaselineInput>(request);

  if (!body.ok) {
    return body.response;
  }

  const parsed = setCheckProfileBaselineSchema.safeParse(body.data);

  if (!parsed.success) {
    return json(
      {
        error: 'Invalid baseline payload',
        issues: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  const baselineRun = repository.getCheckProfileRun(parsed.data.runId);

  if (!baselineRun || baselineRun.profileId !== profile.id) {
    return json({ error: 'Baseline run not found for this profile' }, { status: 404 });
  }

  const nextProfile: CheckProfile = {
    ...profile,
    baseline: {
      runId: baselineRun.id,
      pinnedAt: new Date().toISOString()
    },
    updatedAt: new Date().toISOString()
  };

  repository.saveCheckProfile(nextProfile);

  return json(
    {
      profile: nextProfile,
      baselineRun
    } satisfies CheckProfileBaselineResponse,
    { status: 200 }
  );
}

function handleClearCheckProfileBaseline(profileId: string) {
  const profile = repository.getCheckProfile(profileId);

  if (!profile) {
    return json({ error: 'Check profile not found' }, { status: 404 });
  }

  const nextProfile: CheckProfile = {
    ...profile,
    baseline: null,
    updatedAt: new Date().toISOString()
  };

  repository.saveCheckProfile(nextProfile);

  return json(
    {
      profile: nextProfile,
      baselineRun: null
    } satisfies CheckProfileBaselineResponse,
    { status: 200 }
  );
}

async function handleUpsertProperty(request: Request, existing?: Property) {
  const body = await parseJsonBody<CreatePropertyInput | UpdatePropertyInput>(request);

  if (!body.ok) {
    return body.response;
  }

  const parsed = (existing ? updatePropertySchema : createPropertySchema).safeParse(body.data);

  if (!parsed.success) {
    return json(
      {
        error: 'Invalid property payload',
        issues: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  try {
    const now = new Date().toISOString();
    const name = requireTrimmedText(parsed.data.name, 'Property name');
    const baseUrl = validateMeasurementUrl(parsed.data.baseUrl.trim()).toString();
    ensureUniqueProperty({ id: existing?.id ?? null, name, baseUrl });

    const property: Property = {
      id: existing?.id ?? `property_${crypto.randomUUID()}`,
      name,
      baseUrl,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    repository.saveProperty(property);
    return json({ property }, { status: existing ? 200 : 201 });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Property base URL is invalid'
      },
      { status: error instanceof DuplicateEntityError ? 409 : 400 }
    );
  }
}

async function handleUpsertRouteSet(request: Request, existing?: RouteSet) {
  const body = await parseJsonBody<CreateRouteSetInput | UpdateRouteSetInput>(request);

  if (!body.ok) {
    return body.response;
  }

  const parsed = (existing ? updateRouteSetSchema : createRouteSetSchema).safeParse(body.data);

  if (!parsed.success) {
    return json(
      {
        error: 'Invalid route set payload',
        issues: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  const property = repository.getProperty(parsed.data.propertyId);

  if (!property) {
    return json({ error: 'Property not found' }, { status: 404 });
  }

  const dependentProfiles = existing
    ? repository.listCheckProfiles().filter((profile) => profile.routeSetId === existing.id)
    : [];

  if (existing && existing.propertyId !== property.id && dependentProfiles.length > 0) {
    return json(
      {
        error: 'Route sets that are already used by check profiles cannot move to another property.'
      },
      { status: 409 }
    );
  }

  try {
    const now = new Date().toISOString();
    const name = requireTrimmedText(parsed.data.name, 'Route set name');
    const routes = sanitizeRouteInputs(parsed.data.routes);
    ensureUniqueRouteSet({ id: existing?.id ?? null, propertyId: property.id, name });

    const routeSet: RouteSet = {
      id: existing?.id ?? `routeset_${crypto.randomUUID()}`,
      propertyId: property.id,
      name,
      routes: mergeRouteEntries(routes, existing?.routes ?? []),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    repository.saveRouteSet(routeSet);
    return json({ routeSet }, { status: existing ? 200 : 201 });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Route set payload is invalid'
      },
      { status: error instanceof DuplicateEntityError ? 409 : 400 }
    );
  }
}

async function handleUpsertRegionPack(request: Request, existing?: RegionPack) {
  const body = await parseJsonBody<CreateRegionPackInput | UpdateRegionPackInput>(request);

  if (!body.ok) {
    return body.response;
  }

  const parsed = (existing ? updateRegionPackSchema : createRegionPackSchema).safeParse(body.data);

  if (!parsed.success) {
    return json(
      {
        error: 'Invalid region pack payload',
        issues: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  try {
    const now = new Date().toISOString();
    const name = requireTrimmedText(parsed.data.name, 'Region pack name');
    const regions = resolveRequestedRegions({
      requestedRegions: dedupeRegions(parsed.data.regions),
      availability: getRegionAvailability(),
      fallbackRegions: runtime.activeRegionCodes
    });
    ensureUniqueRegionPack({ id: existing?.id ?? null, name });

    const regionPack: RegionPack = {
      id: existing?.id ?? `regionpack_${crypto.randomUUID()}`,
      name,
      regions,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    repository.saveRegionPack(regionPack);
    return json({ regionPack }, { status: existing ? 200 : 201 });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Region pack is invalid'
      },
      { status: error instanceof DuplicateEntityError ? 409 : 400 }
    );
  }
}

async function handleUpsertCheckProfile(request: Request, existing?: CheckProfile) {
  const body = await parseJsonBody<CreateCheckProfileInput | UpdateCheckProfileInput>(request);

  if (!body.ok) {
    return body.response;
  }

  const parsed = (existing ? updateCheckProfileSchema : createCheckProfileSchema).safeParse(body.data);

  if (!parsed.success) {
    return json(
      {
        error: 'Invalid check profile payload',
        issues: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  const property = repository.getProperty(parsed.data.propertyId);
  if (!property) {
    return json({ error: 'Property not found' }, { status: 404 });
  }

  const routeSet = repository.getRouteSet(parsed.data.routeSetId);
  if (!routeSet || routeSet.propertyId !== property.id) {
    return json({ error: 'Route set not found for property' }, { status: 404 });
  }

  const regionPack = repository.getRegionPack(parsed.data.regionPackId);
  if (!regionPack) {
    return json({ error: 'Region pack not found' }, { status: 404 });
  }

  try {
    const now = new Date().toISOString();
    const name = requireTrimmedText(parsed.data.name, 'Check profile name');
    const note = normalizeOptionalText(parsed.data.note);
    const requestConfig = normalizeCustomRequestConfig(parsed.data.request);
    const monitorPolicy = normalizeMonitorPolicy(parsed.data.monitorPolicy);
    const alerts = normalizeAlertConfig(parsed.data.alerts, existing?.alerts);
    ensureUniqueCheckProfile({
      id: existing?.id ?? null,
      propertyId: property.id,
      name
    });

    const profile: CheckProfile = {
      id: existing?.id ?? `profile_${crypto.randomUUID()}`,
      propertyId: property.id,
      routeSetId: routeSet.id,
      regionPackId: regionPack.id,
      name,
      note,
      request: requestConfig,
      monitorPolicy,
      alerts,
      schedule: buildProfileSchedule(existing, parsed.data.scheduleIntervalMinutes, now),
      baseline: resolveUpdatedProfileBaseline(existing, routeSet.id, regionPack.id),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    repository.saveCheckProfile(profile);
    return json({ profile }, { status: existing ? 200 : 201 });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Invalid check profile payload'
      },
      { status: error instanceof DuplicateEntityError ? 409 : 400 }
    );
  }
}

async function handleRunCheckProfile(profileId: string, request: Request) {
  const profile = repository.getCheckProfile(profileId);

  if (!profile) {
    return json({ error: 'Check profile not found' }, { status: 404 });
  }

  const requesterIp = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? null;
  let createdJobs: CreatedProfileJob[];

  try {
    createdJobs = createJobsForProfile(profile, requesterIp);
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Failed to create profile jobs'
      },
      { status: 404 }
    );
  }

  const run = createCheckProfileRunRecord(profile, 'manual', createdJobs);
  void processCheckProfileRun(profile, run, createdJobs);

  const response: CheckProfileRunResponse = {
    profile,
    jobs: createdJobs.map((item) => item.job)
  };

  return json(response, { status: 201 });
}

async function handleDispatchScheduledProfiles(_request: Request, url: URL) {
  const dispatchAt = parseDispatchTime(url.searchParams.get('now'));
  const dueProfiles = repository
    .listCheckProfiles()
    .filter(
      (profile) =>
        profile.schedule?.nextRunAt != null && new Date(profile.schedule.nextRunAt).getTime() <= dispatchAt.getTime()
    );

  const triggeredProfiles = dueProfiles.flatMap((profile) => {
    let createdJobs: CreatedProfileJob[];

    try {
      createdJobs = createJobsForProfile(profile, null);
    } catch (error) {
      console.warn(
        JSON.stringify({
          service: 'webperf-api',
          warning: 'scheduled_profile_dispatch_failed',
          profileId: profile.id,
          error: error instanceof Error ? error.message : 'Unknown profile dispatch error'
        })
      );
      return [];
    }

    const run = createCheckProfileRunRecord(profile, 'schedule', createdJobs);
    void processCheckProfileRun(profile, run, createdJobs);

    const updatedProfile: CheckProfile = {
      ...profile,
      schedule: profile.schedule
        ? {
          ...profile.schedule,
          lastRunAt: dispatchAt.toISOString(),
          lastRunJobCount: createdJobs.length,
          nextRunAt: computeNextRunAt(dispatchAt.toISOString(), profile.schedule.intervalMinutes)
        }
        : null,
      updatedAt: dispatchAt.toISOString()
    };

    repository.saveCheckProfile(updatedProfile);

    return [{
      profileId: profile.id,
      jobIds: run.routes.map((route) => route.jobId),
      nextRunAt: updatedProfile.schedule?.nextRunAt ?? null
    }];
  });

  const response: SchedulerDispatchResponse = {
    dispatchedAt: dispatchAt.toISOString(),
    triggeredCount: triggeredProfiles.length,
    triggeredProfiles
  };

  return json(response, { status: 200 });
}

function handleListCheckProfileRuns(profileId: string, query?: ListQuery) {
  const profile = repository.getCheckProfile(profileId);

  if (!profile) {
    return json({ error: 'Check profile not found' }, { status: 404 });
  }

  const payload = buildCheckProfileRunListResponse(profile.id, query);

  return json(payload, { status: 200 });
}

function handleGetCheckProfileRun(profileId: string, runId: string) {
  const profile = repository.getCheckProfile(profileId);

  if (!profile) {
    return json({ error: 'Check profile not found' }, { status: 404 });
  }

  const run = repository.getCheckProfileRun(runId);

  if (!run || run.profileId !== profile.id) {
    return json({ error: 'Check profile run not found' }, { status: 404 });
  }

  const jobs = run.routes
    .map((route) => repository.getJob(route.jobId))
    .filter((job): job is LatencyJobDetail => job !== null);

  const payload: CheckProfileRunDetailResponse = {
    profile,
    run,
    jobs
  };

  return json(payload, { status: 200 });
}

function handleGetLatestCheckProfileComparison(profileId: string) {
  const profile = repository.getCheckProfile(profileId);

  if (!profile) {
    return json({ error: 'Check profile not found' }, { status: 404 });
  }

  const runs = repository.listCheckProfileRuns(profile.id);

  if (runs.length === 0) {
    return json({ error: 'No check profile runs found' }, { status: 404 });
  }

  const currentRun = runs[0]!;
  const previousRun = runs[1] ?? null;
  const baselineRun = resolveBaselineRun(profile);
  const comparison = buildProfileComparison(currentRun, previousRun, 'latest_previous');

  const payload: CheckProfileLatestComparisonResponse = {
    profile,
    currentRun,
    previousRun,
    comparedRun: previousRun,
    baselineRun,
    mode: 'latest_previous',
    summary: comparison.summary,
    routes: comparison.routes
  };

  return json(payload, { status: 200 });
}

function handleGetBaselineCheckProfileComparison(profileId: string) {
  const profile = repository.getCheckProfile(profileId);

  if (!profile) {
    return json({ error: 'Check profile not found' }, { status: 404 });
  }

  const runs = repository.listCheckProfileRuns(profile.id);

  if (runs.length === 0) {
    return json({ error: 'No check profile runs found' }, { status: 404 });
  }

  const currentRun = runs[0]!;
  const baselineRun = resolveBaselineRun(profile);

  if (!baselineRun) {
    return json({ error: 'No baseline run pinned for this profile' }, { status: 404 });
  }

  const payload = buildProfileComparisonResponse(profile, currentRun, baselineRun, 'baseline');
  return json(payload, { status: 200 });
}

function handleGetCheckProfileRunComparison(profileId: string, runId: string, url: URL) {
  const profile = repository.getCheckProfile(profileId);

  if (!profile) {
    return json({ error: 'Check profile not found' }, { status: 404 });
  }

  const currentRun = repository.getCheckProfileRun(runId);

  if (!currentRun || currentRun.profileId !== profile.id) {
    return json({ error: 'Check profile run not found' }, { status: 404 });
  }

  const against = url.searchParams.get('against');
  const againstRunId = url.searchParams.get('againstRunId');

  let mode: CheckProfileComparisonResponse['mode'] = 'custom';
  let comparedRun: CheckProfileRun | null = null;

  if (against === 'baseline') {
    mode = 'baseline';
    comparedRun = resolveBaselineRun(profile);
  } else if (against === 'previous' || against == null) {
    mode = 'latest_previous';
    comparedRun = findPreviousRun(profile.id, currentRun.id);
  } else if (against === 'custom' && againstRunId) {
    mode = 'custom';
    const candidate = repository.getCheckProfileRun(againstRunId);
    comparedRun = candidate && candidate.profileId === profile.id ? candidate : null;
  } else {
    return json({ error: 'Unsupported comparison target' }, { status: 400 });
  }

  if (!comparedRun) {
    return json({ error: 'Compared run not found for this profile' }, { status: 404 });
  }

  const payload = buildProfileComparisonResponse(profile, currentRun, comparedRun, mode);
  return json(payload, { status: 200 });
}

function handleGetCheckProfileReport(profileId: string) {
  const profile = repository.getCheckProfile(profileId);

  if (!profile) {
    return json({ error: 'Check profile not found' }, { status: 404 });
  }

  const payload = buildCheckProfileReport(profile);
  return json(payload, { status: 200 });
}

function handleExportCheckProfileReport(profileId: string, url: URL) {
  const formatParsed = reportExportFormatSchema.safeParse(url.searchParams.get('format') ?? 'json');

  if (!formatParsed.success) {
    return json({ error: 'Unsupported export format' }, { status: 400 });
  }

  const exportResource = buildExportResource({
    source: {
      type: 'check_report',
      checkId: profileId
    },
    format: formatParsed.data
  });

  return new Response(exportResource.body, {
    status: 200,
    headers: {
      'content-type': exportResource.contentType,
      'content-disposition': `attachment; filename="${exportResource.filename}"`
    }
  });
}

function handleJobStream(jobId: string) {
  return new Response(createJobSnapshotStream(jobId), {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    }
  });
}

function buildCheckProfileReport(profile: CheckProfile): CheckProfileReportResponse {
  const runs = repository.listCheckProfileRuns(profile.id);
  const latestRun = runs[0] ?? null;
  const recentRuns = runs.slice(0, 10).map((run) => {
    const regressedCount =
      resolveComparisonForRun(profile, run)?.summary.regressed ?? 0;

    return summarizeCheckProfileRunReport({
      profile,
      run,
      jobs: getJobsForRun(run),
      regressedCount
    });
  });
  const latestRunDetail =
    latestRun == null
      ? null
      : ({
          profile,
          run: latestRun,
          jobs: getJobsForRun(latestRun)
        } satisfies CheckProfileRunDetailResponse);
  const latestRunSummary = recentRuns[0] ?? null;
  const latestComparison =
    latestRun == null ? null : safeLatestComparison(profile, latestRun);
  const baselineComparison =
    latestRun == null ? null : safeBaselineComparison(profile, latestRun);

  return {
    profile,
    latestRun: latestRunDetail,
    latestRunSummary,
    latestComparison,
    baselineComparison,
    recentRuns
  };
}

async function processJob(jobId: string) {
  const job = repository.getJob(jobId);

  if (!job) {
    return;
  }

  if (!runtime.probeSharedSecret) {
    for (const target of job.targets) {
      markTargetFailed(target, 'missing_probe_shared_secret', 'Probe shared secret is not configured');
    }
    finalizeJob(job);
    return;
  }

  for (const target of job.targets) {
    job.startedAt ??= new Date().toISOString();
    target.attemptNo = 1;
    target.status = 'measuring';
    target.startedAt ??= new Date().toISOString();
    target.updatedAt = new Date().toISOString();
    recomputeJob(job);

    const probeBaseUrl = runtime.probeBaseUrls[target.region];

    if (!probeBaseUrl) {
      markTargetFailed(target, 'missing_probe_region', `No probe base URL is configured for ${target.region}`);
      recomputeJob(job);
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
      payload.signature = await createProbeSignature(runtime.probeSharedSecret, payload);

      const response = await fetch(new URL('/measure', probeBaseUrl).toString(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(payload satisfies SignedProbeMeasurementRequest)
      });

      if (!response.ok) {
        markTargetFailed(target, `probe_http_${response.status}`, `Probe call failed with ${response.status}`);
        recomputeJob(job);
        continue;
      }

      const parsed = probeMeasurementResponseSchema.safeParse(
        (await response.json()) as ProbeMeasurementResponse
      );

      if (!parsed.success) {
        markTargetFailed(target, 'probe_invalid_payload', 'Probe returned an invalid payload');
        recomputeJob(job);
        continue;
      }

      target.status = parsed.data.measurement.success ? 'succeeded' : 'failed';
      target.latencyMs = parsed.data.measurement.latencyMs;
      target.statusCode = parsed.data.measurement.statusCode;
      target.success = evaluateTargetSuccess(parsed.data.measurement);
      target.status = target.success ? 'succeeded' : 'failed';
      target.probeImpl = parsed.data.measurement.probeImpl;
      target.measurement = parsed.data.measurement;
      target.errorCode = parsed.data.measurement.error
        ? 'probe_measurement_failed'
        : target.success
          ? null
          : 'status_rule_failed';
      target.errorClass = parsed.data.measurement.error || !target.success ? 'terminal' : null;
      target.errorMessage = parsed.data.measurement.error
        ?? (target.success ? null : buildStatusFailureMessage(parsed.data.measurement.statusCode));
      target.finishedAt = parsed.data.measurement.measuredAt;
      target.updatedAt = new Date().toISOString();
      recomputeJob(job);
    } catch (error) {
      markTargetFailed(
        target,
        'probe_runtime_error',
        error instanceof Error ? error.message : 'Unknown probe error'
      );
      recomputeJob(job);
    }
  }

  finalizeJob(job);
}

async function processCheckProfileRun(
  profile: CheckProfile,
  run: CheckProfileRun,
  createdJobs: CreatedProfileJob[]
) {
  await Promise.all(createdJobs.map((item) => processJob(item.job.id)));

  const refreshedRun = repository.getCheckProfileRun(run.id) ?? run;
  const comparison = resolveComparisonForRun(profile, refreshedRun);
  const jobs = getJobsForRun(refreshedRun);
  const evaluation = evaluateMonitorTargets({
    monitorPolicy: profile.monitorPolicy,
    targets: jobs.flatMap((job) => job.targets),
    regressedCount: comparison?.summary.regressed ?? 0
  });
  const nextRun: CheckProfileRun = {
    ...refreshedRun,
    evaluation,
    alertDeliveries: await dispatchProfileAlerts({
      profile,
      run: refreshedRun,
      jobs,
      evaluation,
      comparison
    })
  };

  repository.saveCheckProfileRun(nextRun);
}

function markTargetFailed(target: MutableTarget, errorCode: string, errorMessage: string) {
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
}

function finalizeJob(job: MutableJob) {
  recomputeJob(job);
  if (job.summary.inflight === 0) {
    job.completedAt = new Date().toISOString();
  }
  repository.saveJob(job);
}

function recomputeJob(job: MutableJob) {
  job.summary = summarizeTargets(job.targets);
  job.status = deriveJobStatus(job.targets);
  job.evaluation = evaluateMonitorTargets({
    monitorPolicy: job.monitorPolicy,
    targets: job.targets
  });
  repository.saveJob(job);
}

function createJobRecord({
  url,
  regions: requestedRegions,
  note,
  requestConfig,
  monitorPolicy,
  requesterIp
}: {
  url: string;
  regions?: RegionCode[];
  note: string | null;
  requestConfig?: CreateLatencyJobInput['request'];
  monitorPolicy?: CreateLatencyJobInput['monitorPolicy'];
  requesterIp: string | null;
}) {
  validateMeasurementUrl(url);

  const regions = resolveRequestedRegions({
    requestedRegions,
    availability: getRegionAvailability(),
    fallbackRegions: runtime.activeRegionCodes
  });

  const now = new Date().toISOString();
  const jobId = `job_${crypto.randomUUID()}`;
  const targets = regions.map<MutableTarget>((region: RegionCode) => ({
    jobId,
    region,
    status: 'queued',
    attemptNo: 0,
    maxAttempts: runtime.maxTargetAttempts,
    latencyMs: null,
    statusCode: null,
    success: null,
    probeImpl: null,
    measurement: null,
    execution: {
      runnerType: 'network_probe',
      provider: 'selfhost',
      locationMode: 'best_effort',
      region,
      city: null,
      runnerVersion: 'probe-rs'
    },
    slotId: null,
    errorCode: null,
    errorClass: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    updatedAt: now
  }));

  const job: MutableJob = {
    id: jobId,
    url,
    status: 'queued',
    note,
    request: normalizeCustomRequestConfig(requestConfig),
    monitorPolicy: normalizeMonitorPolicy(monitorPolicy),
    requestedAt: now,
    startedAt: null,
    completedAt: null,
    requesterIp,
    selectedRegions: regions,
    targets,
    evaluation: null,
    summary: summarizeTargets(targets)
  };

  repository.pruneJobsOlderThan(runtime.retentionDays);
  repository.saveJob(job);

  return job;
}

function createJobsForProfile(profile: CheckProfile, requesterIp: string | null): CreatedProfileJob[] {
  const routeSet = repository.getRouteSet(profile.routeSetId);
  if (!routeSet) {
    throw new Error('Route set not found for profile');
  }

  const regionPack = repository.getRegionPack(profile.regionPackId);
  if (!regionPack) {
    throw new Error('Region pack not found for profile');
  }

  return routeSet.routes.map((route) =>
    ({
      routeId: route.id,
      routeLabel: route.label,
      url: route.url,
      job: createJobRecord({
        url: route.url,
        regions: regionPack.regions,
        note: buildProfileRunNote(profile.name, route.label, profile.note),
        requestConfig: profile.request,
        monitorPolicy: profile.monitorPolicy,
        requesterIp
      })
    }) satisfies CreatedProfileJob
  );
}

function createCheckProfileRunRecord(
  profile: CheckProfile,
  trigger: CheckProfileRun['trigger'],
  createdJobs: CreatedProfileJob[]
) {
  const run: CheckProfileRun = {
    id: `run_${crypto.randomUUID()}`,
    profileId: profile.id,
    trigger,
    createdAt: new Date().toISOString(),
    routeCount: createdJobs.length,
    evaluation: null,
    alertDeliveries: [],
    routes: createdJobs.map((item) => ({
      routeId: item.routeId,
      routeLabel: item.routeLabel,
      url: item.url,
      jobId: item.job.id
    }))
  };

  repository.saveCheckProfileRun(run);
  return run;
}

function buildProfileComparison(
  currentRun: CheckProfileRun,
  comparedRun: CheckProfileRun | null,
  mode: CheckProfileComparisonResponse['mode']
) {
  return buildCheckProfileComparison({
    currentRun,
    currentJobs: getJobsForRun(currentRun),
    comparedRun,
    comparedJobs: comparedRun ? getJobsForRun(comparedRun) : [],
    mode
  });
}

function buildProfileComparisonResponse(
  profile: CheckProfile,
  currentRun: CheckProfileRun,
  comparedRun: CheckProfileRun | null,
  mode: CheckProfileComparisonResponse['mode']
): CheckProfileComparisonResponse {
  const comparison = buildProfileComparison(currentRun, comparedRun, mode);

  return {
    profile,
    currentRun,
    comparedRun,
    mode,
    summary: comparison.summary,
    routes: comparison.routes
  };
}

function getJobsForRun(run: CheckProfileRun) {
  return run.routes
    .map((route) => repository.getJob(route.jobId))
    .filter((job): job is LatencyJobDetail => job !== null);
}

function resolveBaselineRun(profile: CheckProfile) {
  if (!profile.baseline?.runId) {
    return null;
  }

  const run = repository.getCheckProfileRun(profile.baseline.runId);
  return run && run.profileId === profile.id ? run : null;
}

function findPreviousRun(profileId: string, runId: string) {
  const runs = repository.listCheckProfileRuns(profileId);
  const runIndex = runs.findIndex((run) => run.id === runId);

  if (runIndex < 0) {
    return null;
  }

  return runs[runIndex + 1] ?? null;
}

function evaluateTargetSuccess(measurement: ProbeMeasurementResponse['measurement']) {
  if (measurement.error) {
    return false;
  }

  if (measurement.statusCode == null) {
    return false;
  }

  return measurement.statusCode >= 200 && measurement.statusCode < 400;
}

function buildStatusFailureMessage(statusCode: number | null | undefined) {
  if (statusCode == null) {
    return null;
  }

  return `Status ${statusCode} did not satisfy status_2xx_3xx`;
}

function normalizeCustomRequestConfig(request: CreateLatencyJobInput['request'] | CreateCheckProfileInput['request']) {
  return {
    method: request?.method ?? 'GET',
    headers: (request?.headers ?? []).map((header) => ({
      name: requireTrimmedText(header.name, 'Header name'),
      value: header.value.trim()
    })),
    body:
      request?.body == null
        ? null
        : {
            mode: request.body.mode,
            contentType: normalizeOptionalText(request.body.contentType),
            value: request.body.value
          }
  } satisfies NonNullable<CreateLatencyJobInput['request']>;
}

function normalizeMonitorPolicy(
  monitorPolicy: CreateLatencyJobInput['monitorPolicy'] | CreateCheckProfileInput['monitorPolicy'] | undefined
) {
  return {
    monitorType: monitorPolicy?.monitorType ?? 'latency',
    successRule: monitorPolicy?.successRule ?? 'status_2xx_3xx',
    latencyThresholdMs: monitorPolicy?.latencyThresholdMs ?? null
  } satisfies NonNullable<CreateLatencyJobInput['monitorPolicy']>;
}

function normalizeAlertConfig(
  alerts: CreateCheckProfileInput['alerts'] | undefined,
  existing?: CheckProfile['alerts']
) {
  const mergedTargets = alerts?.webhookTargets?.map((target, index) => {
    const previousTarget = existing?.webhookTargets?.[index] ?? null;
    return {
      id: previousTarget?.id ?? `webhook_${crypto.randomUUID()}`,
      name: requireTrimmedText(target.name, 'Webhook target name'),
      url: target.url.trim(),
      enabled: target.enabled ?? true,
      secret: normalizeOptionalText(target.secret)
    };
  }) ?? existing?.webhookTargets ?? [];

  return {
    enabled: alerts?.enabled ?? existing?.enabled ?? false,
    webhookTargets: mergedTargets,
    triggers: {
      onFailure: alerts?.triggers?.onFailure ?? existing?.triggers?.onFailure ?? true,
      onLatencyThresholdBreach:
        alerts?.triggers?.onLatencyThresholdBreach ?? existing?.triggers?.onLatencyThresholdBreach ?? false,
      onRegression: alerts?.triggers?.onRegression ?? existing?.triggers?.onRegression ?? false
    }
  } satisfies NonNullable<CheckProfile['alerts']>;
}

async function dispatchProfileAlerts({
  profile,
  run,
  jobs,
  evaluation,
  comparison
}: {
  profile: CheckProfile;
  run: CheckProfileRun;
  jobs: LatencyJobDetail[];
  evaluation: CheckProfileRun['evaluation'];
  comparison: CheckProfileComparisonResponse | null;
}): Promise<CheckProfileAlertDelivery[]> {
  if (!profile.alerts?.enabled || (profile.alerts.webhookTargets?.length ?? 0) === 0 || !evaluation) {
    return [];
  }

  const shouldAlert =
    (profile.alerts.triggers.onFailure && evaluation.failedChecks > 0) ||
    (profile.alerts.triggers.onLatencyThresholdBreach && evaluation.thresholdBreached) ||
    (profile.alerts.triggers.onRegression && evaluation.regressionDetected);

  if (!shouldAlert) {
    return [];
  }

  const payload = {
    type: 'check_profile.alert',
    profile: {
      id: profile.id,
      name: profile.name
    },
    run: {
      id: run.id,
      createdAt: run.createdAt,
      trigger: run.trigger
    },
    evaluation,
    jobs: jobs.map((job) => ({
      id: job.id,
      url: job.url,
      status: job.status,
      evaluation: job.evaluation ?? null,
      summary: job.summary
    })),
    comparison: comparison
      ? {
          mode: comparison.mode,
          summary: comparison.summary
        }
      : null
  };

  return Promise.all(
    profile.alerts.webhookTargets
      .filter((target) => target.enabled)
      .map(async (target) => {
        const deliveredAt = new Date().toISOString();

        try {
          const response = await fetch(target.url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(target.secret ? { 'x-webperf-signature': target.secret } : {})
            },
            body: JSON.stringify(payload)
          });

          if (!response.ok) {
            return {
              targetId: target.id,
              targetName: target.name,
              url: target.url,
              deliveredAt,
              status: 'failed',
              responseStatus: response.status,
              error: `Webhook responded with ${response.status}`
            } satisfies CheckProfileAlertDelivery;
          }

          return {
            targetId: target.id,
            targetName: target.name,
            url: target.url,
            deliveredAt,
            status: 'sent',
            responseStatus: response.status,
            error: null
          } satisfies CheckProfileAlertDelivery;
        } catch (error) {
          return {
            targetId: target.id,
            targetName: target.name,
            url: target.url,
            deliveredAt,
            status: 'failed',
            responseStatus: null,
            error: error instanceof Error ? error.message : 'Webhook delivery failed'
          } satisfies CheckProfileAlertDelivery;
        }
      })
  );
}

function safeLatestComparison(profile: CheckProfile, currentRun: CheckProfileRun) {
  const previousRun = findPreviousRun(profile.id, currentRun.id);

  if (!previousRun) {
    return null;
  }

  const comparison = buildProfileComparison(currentRun, previousRun, 'latest_previous');

  return {
    profile,
    currentRun,
    previousRun,
    comparedRun: previousRun,
    baselineRun: resolveBaselineRun(profile),
    mode: 'latest_previous',
    summary: comparison.summary,
    routes: comparison.routes
  } satisfies CheckProfileLatestComparisonResponse;
}

function safeBaselineComparison(profile: CheckProfile, currentRun: CheckProfileRun) {
  const baselineRun = resolveBaselineRun(profile);

  if (!baselineRun) {
    return null;
  }

  return buildProfileComparisonResponse(profile, currentRun, baselineRun, 'baseline');
}

function resolveComparisonForRun(profile: CheckProfile, run: CheckProfileRun) {
  const baselineRun = resolveBaselineRun(profile);

  if (baselineRun && baselineRun.id !== run.id) {
    return buildProfileComparisonResponse(profile, run, baselineRun, 'baseline');
  }

  const previousRun = findPreviousRun(profile.id, run.id);

  if (!previousRun) {
    return null;
  }

  return buildProfileComparisonResponse(profile, run, previousRun, 'latest_previous');
}

class DuplicateEntityError extends Error {}

function requireTrimmedText(value: string, label: string) {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function normalizeOptionalText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function ensureUniqueProperty({
  id,
  name,
  baseUrl
}: {
  id: string | null;
  name: string;
  baseUrl: string;
}) {
  const duplicate = repository.listProperties().find(
    (property) =>
      property.id !== id &&
      (property.name.toLowerCase() === name.toLowerCase() || property.baseUrl === baseUrl)
  );

  if (duplicate) {
    throw new DuplicateEntityError('Property names and base URLs must be unique.');
  }
}

function ensureUniqueRouteSet({
  id,
  propertyId,
  name
}: {
  id: string | null;
  propertyId: string;
  name: string;
}) {
  const duplicate = repository.listRouteSets().find(
    (routeSet) =>
      routeSet.id !== id &&
      routeSet.propertyId === propertyId &&
      routeSet.name.toLowerCase() === name.toLowerCase()
  );

  if (duplicate) {
    throw new DuplicateEntityError('Route set names must be unique inside a property.');
  }
}

function ensureUniqueRegionPack({
  id,
  name
}: {
  id: string | null;
  name: string;
}) {
  const duplicate = repository.listRegionPacks().find(
    (regionPack) => regionPack.id !== id && regionPack.name.toLowerCase() === name.toLowerCase()
  );

  if (duplicate) {
    throw new DuplicateEntityError('Region pack names must be unique.');
  }
}

function ensureUniqueCheckProfile({
  id,
  propertyId,
  name
}: {
  id: string | null;
  propertyId: string;
  name: string;
}) {
  const duplicate = repository.listCheckProfiles().find(
    (profile) =>
      profile.id !== id &&
      profile.propertyId === propertyId &&
      profile.name.toLowerCase() === name.toLowerCase()
  );

  if (duplicate) {
    throw new DuplicateEntityError('Check profile names must be unique inside a property.');
  }
}

function sanitizeRouteInputs(routes: CreateRouteSetInput['routes']) {
  const seenLabels = new Set<string>();
  const seenUrls = new Set<string>();

  return routes.map((route, index) => {
    const label = requireTrimmedText(route.label, `Route label ${index + 1}`);
    const url = validateMeasurementUrl(route.url.trim()).toString();
    const normalizedLabel = label.toLowerCase();

    if (seenLabels.has(normalizedLabel)) {
      throw new DuplicateEntityError(`Route label "${label}" appears more than once.`);
    }

    if (seenUrls.has(url)) {
      throw new DuplicateEntityError(`Route URL "${url}" appears more than once.`);
    }

    seenLabels.add(normalizedLabel);
    seenUrls.add(url);

    return {
      label,
      url
    };
  });
}

function mergeRouteEntries(
  routes: Array<{ label: string; url: string }>,
  existingRoutes: RouteSet['routes']
) {
  return routes.map((route) => {
    const matchingRoute =
      existingRoutes.find((candidate) => candidate.label === route.label && candidate.url === route.url) ?? null;

    return {
      id: matchingRoute?.id ?? `route_${crypto.randomUUID()}`,
      label: route.label,
      url: route.url
    };
  });
}

function buildProfileSchedule(
  existing: CheckProfile | undefined,
  scheduleIntervalMinutes: number | undefined,
  now: string
) {
  if (scheduleIntervalMinutes == null) {
    return null;
  }

  if (existing?.schedule && existing.schedule.intervalMinutes === scheduleIntervalMinutes) {
    return {
      intervalMinutes: scheduleIntervalMinutes,
      nextRunAt: existing.schedule.nextRunAt,
      lastRunAt: existing.schedule.lastRunAt,
      lastRunJobCount: existing.schedule.lastRunJobCount
    };
  }

  return {
    intervalMinutes: scheduleIntervalMinutes,
    nextRunAt: computeNextRunAt(now, scheduleIntervalMinutes),
    lastRunAt: existing?.schedule?.lastRunAt ?? null,
    lastRunJobCount: existing?.schedule?.lastRunJobCount ?? null
  };
}

function resolveUpdatedProfileBaseline(
  existing: CheckProfile | undefined,
  nextRouteSetId: string,
  nextRegionPackId: string
) {
  if (!existing?.baseline) {
    return null;
  }

  if (existing.routeSetId !== nextRouteSetId || existing.regionPackId !== nextRegionPackId) {
    return null;
  }

  return resolveBaselineRun(existing)?.id === existing.baseline.runId ? existing.baseline : null;
}

function parseRuntime(input: Record<string, string | undefined>): SelfhostRuntime {
  const parsed = parseSelfhostApiVars(input);

  return {
    host: parsed.SELFHOST_API_HOST,
    port: parsed.SELFHOST_API_PORT,
    databasePath: parsed.SELFHOST_DATABASE_PATH,
    retentionDays: parsed.SELFHOST_RETENTION_DAYS,
    probeSharedSecret: parsed.PROBE_SHARED_SECRET,
    probeSharedSecretNext: parsed.PROBE_SHARED_SECRET_NEXT,
    activeRegionCodes: parseRegionCodes(parsed.SELFHOST_ACTIVE_REGION_CODES_JSON),
    regionIds: parseRegionMap(parsed.SELFHOST_REGION_IDS_JSON),
    probeBaseUrls: parseRegionMap(parsed.SELFHOST_PROBE_BASE_URLS_JSON),
    maxTargetAttempts: parsed.SELFHOST_MAX_TARGET_ATTEMPTS
  };
}

function getRegionAvailability() {
  return buildRegionAvailabilityList({
    activeRegionCodes: runtime.activeRegionCodes,
    regionHints: runtime.regionIds
  });
}

function parseRegionCodes(jsonValue: string): RegionCode[] {
  try {
    const parsed = JSON.parse(jsonValue);

    if (!Array.isArray(parsed)) {
      return ['tokyo'];
    }

    const values = parsed.filter(
      (value): value is RegionCode => typeof value === 'string' && regionCodeSet.has(value)
    );

    return values.length > 0 ? values : ['tokyo'];
  } catch {
    return ['tokyo'];
  }
}

function parseRegionMap(jsonValue: string): Partial<Record<RegionCode, string>> {
  try {
    const parsed = JSON.parse(jsonValue);

    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => {
        if (!regionCodeSet.has(key) || typeof value !== 'string' || value.length === 0) {
          return [];
        }

        return [[key, value]];
      })
    ) as Partial<Record<RegionCode, string>>;
  } catch {
    return {};
  }
}

async function parseJsonBody<T>(request: Request) {
  try {
    return {
      ok: true as const,
      data: (await request.json()) as T
    };
  } catch {
    return {
      ok: false as const,
      response: json(
        {
          error: 'Invalid JSON payload'
        },
        { status: 400 }
      )
    };
  }
}

function toJsonError(error: unknown) {
  if (error instanceof ORPCError) {
    const status =
      error.code === 'NOT_FOUND'
        ? 404
        : error.code === 'BAD_REQUEST'
          ? 400
          : 500;

    return json(
      {
        error: error.message,
        code: error.code,
        data: error.data ?? null
      },
      { status }
    );
  }

  return json(
    {
      error: error instanceof Error ? error.message : 'Unexpected error'
    },
    { status: 500 }
  );
}

function buildProfileRunNote(profileName: string, routeLabel: string, profileNote: string | null) {
  const parts = [profileName, routeLabel, profileNote].filter((value): value is string => Boolean(value?.trim()));
  return parts.join(' · ').slice(0, 200);
}

function computeNextRunAt(fromIso: string, intervalMinutes: number) {
  return new Date(new Date(fromIso).getTime() + intervalMinutes * 60 * 1000).toISOString();
}

function parseDispatchTime(value: string | null) {
  if (!value) {
    return new Date();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers ?? {})
    }
  });
}

type OrpcContext = {
  request: Request;
};

const control = implement(controlContract).$context<OrpcContext>();

const createInternalRequest = (
  path: string,
  init?: { method?: string; body?: unknown; requesterIp?: string | null }
) => {
  const headers = new Headers();

  if (init?.requesterIp) {
    headers.set('x-forwarded-for', init.requesterIp);
    headers.set('x-real-ip', init.requesterIp);
  }

  let body: string | undefined;

  if (init?.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.body);
  }

  return new Request(`http://control.internal${path}`, {
    method: init?.method ?? 'GET',
    headers,
    body
  });
};

const readResponsePayload = async (response: Response) => {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return await response.json();
  }

  return await response.text();
};

const toOrpcError = async (response: Response) => {
  const payload = await readResponsePayload(response);
  const fallbackMessage = response.statusText || 'Request failed';
  const message =
    payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : typeof payload === 'string' && payload.length > 0
        ? payload
        : fallbackMessage;

  switch (response.status) {
    case 404:
      return new ORPCError('NOT_FOUND', { message, data: payload });
    case 400:
    case 409:
      return new ORPCError('BAD_REQUEST', { message, data: payload });
    default:
      return new ORPCError('INTERNAL_SERVER_ERROR', { message, data: payload });
  }
};

const unwrapJsonResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    throw await toOrpcError(response);
  }

  return (await readResponsePayload(response)) as T;
};

const requesterIpFromContext = (context: OrpcContext) =>
  context.request.headers.get('cf-connecting-ip')
  ?? context.request.headers.get('x-forwarded-for')
  ?? context.request.headers.get('x-real-ip');

const controlRouter = control.router({
  health: control.health.handler(async () => buildHealthPayload()),
  regions: control.regions.handler(async () => ({
    regions: getRegionAvailability()
  })),
  jobs: {
    list: control.jobs.list.handler(async (): Promise<JobListResponse> =>
      buildJobListResponse()
    ),
    create: control.jobs.create.handler(async ({ input, context }) =>
      unwrapJsonResponse<{ job: LatencyJobDetail }>(
        await handleCreateJob(
          createInternalRequest('/v1/jobs', {
            method: 'POST',
            body: input,
            requesterIp: requesterIpFromContext(context)
          })
        )
      )
    ),
    get: control.jobs.get.handler(async ({ input }) => {
      const job = repository.getJob(input.params.jobId);

      if (!job) {
        throw new ORPCError('NOT_FOUND', { message: 'Job not found' });
      }

      return job;
    })
  },
  properties: {
    list: control.properties.list.handler(async (): Promise<PropertyListResponse> =>
      buildPropertyListResponse()
    ),
    create: control.properties.create.handler(async ({ input }) =>
      unwrapJsonResponse<{ property: Property }>(
        await handleCreateProperty(
          createInternalRequest('/v1/properties', {
            method: 'POST',
            body: input
          })
        )
      )
    ),
    get: control.properties.get.handler(async ({ input }) => {
      const property = repository.getProperty(input.params.id);

      if (!property) {
        throw new ORPCError('NOT_FOUND', { message: 'Property not found' });
      }

      return property;
    }),
    update: control.properties.update.handler(async ({ input }) =>
      unwrapJsonResponse<{ property: Property }>(
        await handleUpdateProperty(
          input.params.id,
          createInternalRequest(`/v1/properties/${input.params.id}`, {
            method: 'PUT',
            body: input.body
          })
        )
      )
    ),
    delete: control.properties.delete.handler(async ({ input }) =>
      unwrapJsonResponse<{ ok: boolean }>(handleDeleteProperty(input.params.id))
    )
  },
  routeSets: {
    list: control.routeSets.list.handler(async (): Promise<RouteSetListResponse> =>
      buildRouteSetListResponse()
    ),
    create: control.routeSets.create.handler(async ({ input }) =>
      unwrapJsonResponse<{ routeSet: RouteSet }>(
        await handleCreateRouteSet(
          createInternalRequest('/v1/route-sets', {
            method: 'POST',
            body: input
          })
        )
      )
    ),
    get: control.routeSets.get.handler(async ({ input }) => {
      const routeSet = repository.getRouteSet(input.params.id);

      if (!routeSet) {
        throw new ORPCError('NOT_FOUND', { message: 'Route set not found' });
      }

      return routeSet;
    }),
    update: control.routeSets.update.handler(async ({ input }) =>
      unwrapJsonResponse<{ routeSet: RouteSet }>(
        await handleUpdateRouteSet(
          input.params.id,
          createInternalRequest(`/v1/route-sets/${input.params.id}`, {
            method: 'PUT',
            body: input.body
          })
        )
      )
    ),
    delete: control.routeSets.delete.handler(async ({ input }) =>
      unwrapJsonResponse<{ ok: boolean }>(handleDeleteRouteSet(input.params.id))
    )
  },
  regionPacks: {
    list: control.regionPacks.list.handler(async (): Promise<RegionPackListResponse> =>
      buildRegionPackListResponse()
    ),
    create: control.regionPacks.create.handler(async ({ input }) =>
      unwrapJsonResponse<{ regionPack: RegionPack }>(
        await handleCreateRegionPack(
          createInternalRequest('/v1/region-packs', {
            method: 'POST',
            body: input
          })
        )
      )
    ),
    get: control.regionPacks.get.handler(async ({ input }) => {
      const regionPack = repository.getRegionPack(input.params.id);

      if (!regionPack) {
        throw new ORPCError('NOT_FOUND', { message: 'Region pack not found' });
      }

      return regionPack;
    }),
    update: control.regionPacks.update.handler(async ({ input }) =>
      unwrapJsonResponse<{ regionPack: RegionPack }>(
        await handleUpdateRegionPack(
          input.params.id,
          createInternalRequest(`/v1/region-packs/${input.params.id}`, {
            method: 'PUT',
            body: input.body
          })
        )
      )
    ),
    delete: control.regionPacks.delete.handler(async ({ input }) =>
      unwrapJsonResponse<{ ok: boolean }>(handleDeleteRegionPack(input.params.id))
    )
  },
  checkProfiles: {
    list: control.checkProfiles.list.handler(async (): Promise<CheckProfileListResponse> =>
      buildCheckProfileListResponse()
    ),
    create: control.checkProfiles.create.handler(async ({ input }) =>
      unwrapJsonResponse<{ profile: CheckProfile }>(
        await handleCreateCheckProfile(
          createInternalRequest('/v1/check-profiles', {
            method: 'POST',
            body: input
          })
        )
      )
    ),
    get: control.checkProfiles.get.handler(async ({ input }) => {
      const profile = repository.getCheckProfile(input.params.id);

      if (!profile) {
        throw new ORPCError('NOT_FOUND', { message: 'Check profile not found' });
      }

      return profile;
    }),
    update: control.checkProfiles.update.handler(async ({ input }) =>
      unwrapJsonResponse<{ profile: CheckProfile }>(
        await handleUpdateCheckProfile(
          input.params.id,
          createInternalRequest(`/v1/check-profiles/${input.params.id}`, {
            method: 'PUT',
            body: input.body
          })
        )
      )
    ),
    delete: control.checkProfiles.delete.handler(async ({ input }) =>
      unwrapJsonResponse<{ ok: boolean; deletedRunCount: number }>(handleDeleteCheckProfile(input.params.id))
    ),
    baseline: {
      get: control.checkProfiles.baseline.get.handler(async ({ input }): Promise<CheckProfileBaselineResponse> =>
        unwrapJsonResponse(handleGetCheckProfileBaseline(input.params.id))
      ),
      set: control.checkProfiles.baseline.set.handler(async ({ input }): Promise<CheckProfileBaselineResponse> =>
        unwrapJsonResponse(
          await handleSetCheckProfileBaseline(
            input.params.id,
            createInternalRequest(`/v1/check-profiles/${input.params.id}/baseline`, {
              method: 'PUT',
              body: input.body
            })
          )
        )
      ),
      clear: control.checkProfiles.baseline.clear.handler(async ({ input }): Promise<CheckProfileBaselineResponse> =>
        unwrapJsonResponse(handleClearCheckProfileBaseline(input.params.id))
      )
    },
    runs: {
      list: control.checkProfiles.runs.list.handler(async ({ input }): Promise<CheckProfileRunListResponse> =>
        unwrapJsonResponse(handleListCheckProfileRuns(input.params.id))
      ),
      create: control.checkProfiles.runs.create.handler(async ({ input, context }): Promise<CheckProfileRunResponse> =>
        unwrapJsonResponse(
          await handleRunCheckProfile(
            input.params.id,
            createInternalRequest(`/v1/check-profiles/${input.params.id}/runs`, {
              method: 'POST',
              body: {},
              requesterIp: requesterIpFromContext(context)
            })
          )
        )
      ),
      get: control.checkProfiles.runs.get.handler(async ({ input }): Promise<CheckProfileRunDetailResponse> =>
        unwrapJsonResponse(handleGetCheckProfileRun(input.params.id, input.params.runId))
      ),
      compare: control.checkProfiles.runs.compare.handler(async ({ input }): Promise<CheckProfileComparisonResponse> => {
        const search = new URLSearchParams();

        if (input.query.against) {
          search.set('against', input.query.against);
        }

        if (input.query.againstRunId) {
          search.set('againstRunId', input.query.againstRunId);
        }

        const compareUrl = new URL(`http://control.internal/v1/check-profiles/${input.params.id}/runs/${input.params.runId}/compare`);
        compareUrl.search = search.toString();

        return unwrapJsonResponse(handleGetCheckProfileRunComparison(input.params.id, input.params.runId, compareUrl));
      })
    },
    compareLatest: control.checkProfiles.compareLatest.handler(async ({ input }): Promise<CheckProfileLatestComparisonResponse> =>
      unwrapJsonResponse(handleGetLatestCheckProfileComparison(input.params.id))
    ),
    compareBaseline: control.checkProfiles.compareBaseline.handler(async ({ input }): Promise<CheckProfileComparisonResponse> =>
      unwrapJsonResponse(handleGetBaselineCheckProfileComparison(input.params.id))
    ),
    report: control.checkProfiles.report.handler(async ({ input }): Promise<CheckProfileReportResponse> =>
      unwrapJsonResponse(handleGetCheckProfileReport(input.params.id))
    )
  },
  scheduler: {
    dispatch: control.scheduler.dispatch.handler(async ({ input }): Promise<SchedulerDispatchResponse> => {
      const dispatchUrl = new URL('http://control.internal/v1/scheduler/dispatch');

      if (input.now) {
        dispatchUrl.searchParams.set('now', input.now);
      }

      return unwrapJsonResponse(
        await handleDispatchScheduledProfiles(
          createInternalRequest(`/v1/scheduler/dispatch${dispatchUrl.search}`, {
            method: 'POST'
          }),
          dispatchUrl
        )
      );
    })
  }
});

const publicApi = implement(publicContract).$context<OrpcContext>();
const appApi = implement(appContract).$context<OrpcContext>();
const opsApi = implement(opsContract).$context<OrpcContext>();

const publicRouter = publicApi.router({
  capabilities: {
    get: publicApi.capabilities.get.handler(async () => buildPublicCapabilitiesPayload())
  },
  regions: {
    list: publicApi.regions.list.handler(async () => ({
      regions: getRegionAvailability()
    }))
  },
  sites: {
    list: publicApi.sites.list.handler(async ({ input }) => toSitesPayload(input.query)),
    create: publicApi.sites.create.handler(async ({ input }) => {
      const response = await handleCreateProperty(
        createInternalRequest('/v1/properties', {
          method: 'POST',
          body: input
        })
      );
      const payload = await unwrapJsonResponse<{ property: Property }>(response);
      return { site: payload.property };
    }),
    get: publicApi.sites.get.handler(async ({ input }) => {
      const site = repository.getProperty(input.params.siteId);

      if (!site) {
        throw new ORPCError('NOT_FOUND', { message: 'Site not found' });
      }

      return site;
    }),
    update: publicApi.sites.update.handler(async ({ input }) => {
      const response = await handleUpdateProperty(
        input.params.siteId,
        createInternalRequest(`/v1/properties/${input.params.siteId}`, {
          method: 'PUT',
          body: input.body
        })
      );
      const payload = await unwrapJsonResponse<{ property: Property }>(response);
      return { site: payload.property };
    }),
    remove: publicApi.sites.remove.handler(async ({ input }) =>
      unwrapJsonResponse<{ ok: boolean }>(handleDeleteProperty(input.params.siteId))
    )
  },
  routeGroups: {
    list: publicApi.routeGroups.list.handler(async ({ input }) => toRouteGroupsPayload(input.query)),
    create: publicApi.routeGroups.create.handler(async ({ input }) => {
      const response = await handleCreateRouteSet(
        createInternalRequest('/v1/route-sets', {
          method: 'POST',
          body: input
        })
      );
      const payload = await unwrapJsonResponse<{ routeSet: RouteSet }>(response);
      return { routeGroup: payload.routeSet };
    }),
    get: publicApi.routeGroups.get.handler(async ({ input }) => {
      const routeGroup = repository.getRouteSet(input.params.routeGroupId);

      if (!routeGroup) {
        throw new ORPCError('NOT_FOUND', { message: 'Route group not found' });
      }

      return routeGroup;
    }),
    update: publicApi.routeGroups.update.handler(async ({ input }) => {
      const response = await handleUpdateRouteSet(
        input.params.routeGroupId,
        createInternalRequest(`/v1/route-sets/${input.params.routeGroupId}`, {
          method: 'PUT',
          body: input.body
        })
      );
      const payload = await unwrapJsonResponse<{ routeSet: RouteSet }>(response);
      return { routeGroup: payload.routeSet };
    }),
    remove: publicApi.routeGroups.remove.handler(async ({ input }) =>
      unwrapJsonResponse<{ ok: boolean }>(handleDeleteRouteSet(input.params.routeGroupId))
    )
  },
  regionSets: {
    list: publicApi.regionSets.list.handler(async ({ input }) => toRegionSetsPayload(input.query)),
    create: publicApi.regionSets.create.handler(async ({ input }) => {
      const response = await handleCreateRegionPack(
        createInternalRequest('/v1/region-packs', {
          method: 'POST',
          body: input
        })
      );
      const payload = await unwrapJsonResponse<{ regionPack: RegionPack }>(response);
      return { regionSet: payload.regionPack };
    }),
    get: publicApi.regionSets.get.handler(async ({ input }) => {
      const regionSet = repository.getRegionPack(input.params.regionSetId);

      if (!regionSet) {
        throw new ORPCError('NOT_FOUND', { message: 'Region set not found' });
      }

      return regionSet;
    }),
    update: publicApi.regionSets.update.handler(async ({ input }) => {
      const response = await handleUpdateRegionPack(
        input.params.regionSetId,
        createInternalRequest(`/v1/region-packs/${input.params.regionSetId}`, {
          method: 'PUT',
          body: input.body
        })
      );
      const payload = await unwrapJsonResponse<{ regionPack: RegionPack }>(response);
      return { regionSet: payload.regionPack };
    }),
    remove: publicApi.regionSets.remove.handler(async ({ input }) =>
      unwrapJsonResponse<{ ok: boolean }>(handleDeleteRegionPack(input.params.regionSetId))
    )
  },
  checks: {
    list: publicApi.checks.list.handler(async ({ input }) => toChecksPayload(input.query)),
    create: publicApi.checks.create.handler(async ({ input }) => {
      const response = await handleCreateCheckProfile(
        createInternalRequest('/v1/check-profiles', {
          method: 'POST',
          body: input
        })
      );
      const payload = await unwrapJsonResponse<{ profile: CheckProfile }>(response);
      return { check: payload.profile };
    }),
    get: publicApi.checks.get.handler(async ({ input }) => {
      const check = repository.getCheckProfile(input.params.checkId);

      if (!check) {
        throw new ORPCError('NOT_FOUND', { message: 'Check not found' });
      }

      return check;
    }),
    update: publicApi.checks.update.handler(async ({ input }) => {
      const response = await handleUpdateCheckProfile(
        input.params.checkId,
        createInternalRequest(`/v1/check-profiles/${input.params.checkId}`, {
          method: 'PUT',
          body: input.body
        })
      );
      const payload = await unwrapJsonResponse<{ profile: CheckProfile }>(response);
      return { check: payload.profile };
    }),
    remove: publicApi.checks.remove.handler(async ({ input }) =>
      unwrapJsonResponse<{ ok: boolean; deletedRunCount: number }>(handleDeleteCheckProfile(input.params.checkId))
    ),
    baseline: {
      get: publicApi.checks.baseline.get.handler(async ({ input }) => {
        const payload = await unwrapJsonResponse<CheckProfileBaselineResponse>(
          handleGetCheckProfileBaseline(input.params.checkId)
        );

        return {
          check: payload.profile,
          baselineRun: payload.baselineRun
        };
      }),
      set: publicApi.checks.baseline.set.handler(async ({ input }) => {
        const payload = await unwrapJsonResponse<CheckProfileBaselineResponse>(
          await handleSetCheckProfileBaseline(
            input.params.checkId,
            createInternalRequest(`/v1/check-profiles/${input.params.checkId}/baseline`, {
              method: 'PUT',
              body: input.body
            })
          )
        );

        return {
          check: payload.profile,
          baselineRun: payload.baselineRun
        };
      }),
      clear: publicApi.checks.baseline.clear.handler(async ({ input }) => {
        const payload = await unwrapJsonResponse<CheckProfileBaselineResponse>(
          handleClearCheckProfileBaseline(input.params.checkId)
        );

        return {
          check: payload.profile,
          baselineRun: payload.baselineRun
        };
      })
    },
    runs: {
      list: publicApi.checks.runs.list.handler(async ({ input }) => {
        const payload = await unwrapJsonResponse<CheckProfileRunListResponse>(
          handleListCheckProfileRuns(input.params.checkId, input.query)
        );

        return payload;
      }),
      create: publicApi.checks.runs.create.handler(async ({ input, context }) => {
        const payload = await unwrapJsonResponse<CheckProfileRunResponse>(
          await handleRunCheckProfile(
            input.params.checkId,
            createInternalRequest(`/v1/check-profiles/${input.params.checkId}/runs`, {
              method: 'POST',
              body: {},
              requesterIp: requesterIpFromContext(context)
            })
          )
        );

        return {
          check: payload.profile,
          jobs: payload.jobs
        };
      })
    }
  },
  runs: {
    get: publicApi.runs.get.handler(async ({ input }) => {
      const detail = buildRunDetailById(input.params.runId);

      if (!detail) {
        throw new ORPCError('NOT_FOUND', { message: 'Run not found' });
      }

      return {
        check: detail.profile,
        run: detail.run,
        jobs: detail.jobs
      };
    })
  },
  comparisons: {
    list: publicApi.comparisons.list.handler(async ({ input }) =>
      buildComparisonListResponse(input.query)
    ),
    create: publicApi.comparisons.create.handler(async ({ input }) => buildComparisonResource(input)),
    get: publicApi.comparisons.get.handler(async ({ input }) => {
      const comparison = repository.getComparison(input.params.comparisonId);

      if (!comparison) {
        throw new ORPCError('NOT_FOUND', { message: 'Comparison not found' });
      }

      return comparison;
    })
  },
  exports: {
    list: publicApi.exports.list.handler(async ({ input }) =>
      buildExportListResponse(input.query)
    ),
    create: publicApi.exports.create.handler(async ({ input }) => buildExportResource(input)),
    get: publicApi.exports.get.handler(async ({ input }) => {
      const exportResource = repository.getExport(input.params.exportId);

      if (!exportResource) {
        throw new ORPCError('NOT_FOUND', { message: 'Export not found' });
      }

      return exportResource;
    })
  },
  analyses: {
    list: publicApi.analyses.list.handler(async ({ input }) =>
      buildAnalysisListResponse(input.query)
    ),
    create: publicApi.analyses.create.handler(async ({ input }) => buildAnalysisResource(input)),
    get: publicApi.analyses.get.handler(async ({ input }) => {
      const analysis = repository.getAnalysis(input.params.analysisId);

      if (!analysis) {
        throw new ORPCError('NOT_FOUND', { message: 'Analysis not found' });
      }

      return analysis;
    })
  }
});

const appRouter = appApi.router({
  system: {
    health: appApi.system.health.handler(async () => buildHealthPayload()),
    regions: appApi.system.regions.handler(async () => ({
      regions: getRegionAvailability()
    }))
  },
  properties: {
    list: appApi.properties.list.handler(async ({ input }): Promise<PropertyListResponse> =>
      buildPropertyListResponse(input.query)
    ),
    create: appApi.properties.create.handler(async ({ input }) =>
      unwrapJsonResponse<{ property: Property }>(
        await handleCreateProperty(
          createInternalRequest('/v1/properties', {
            method: 'POST',
            body: input
          })
        )
      )
    ),
    get: appApi.properties.get.handler(async ({ input }) => {
      const property = repository.getProperty(input.params.id);

      if (!property) {
        throw new ORPCError('NOT_FOUND', { message: 'Property not found' });
      }

      return property;
    }),
    update: appApi.properties.update.handler(async ({ input }) =>
      unwrapJsonResponse<{ property: Property }>(
        await handleUpdateProperty(
          input.params.id,
          createInternalRequest(`/v1/properties/${input.params.id}`, {
            method: 'PUT',
            body: input.body
          })
        )
      )
    ),
    delete: appApi.properties.delete.handler(async ({ input }) =>
      unwrapJsonResponse<{ ok: boolean }>(handleDeleteProperty(input.params.id))
    )
  },
  routeSets: {
    list: appApi.routeSets.list.handler(async ({ input }): Promise<RouteSetListResponse> =>
      buildRouteSetListResponse(input.query)
    ),
    create: appApi.routeSets.create.handler(async ({ input }) =>
      unwrapJsonResponse<{ routeSet: RouteSet }>(
        await handleCreateRouteSet(
          createInternalRequest('/v1/route-sets', {
            method: 'POST',
            body: input
          })
        )
      )
    ),
    get: appApi.routeSets.get.handler(async ({ input }) => {
      const routeSet = repository.getRouteSet(input.params.id);

      if (!routeSet) {
        throw new ORPCError('NOT_FOUND', { message: 'Route set not found' });
      }

      return routeSet;
    }),
    update: appApi.routeSets.update.handler(async ({ input }) =>
      unwrapJsonResponse<{ routeSet: RouteSet }>(
        await handleUpdateRouteSet(
          input.params.id,
          createInternalRequest(`/v1/route-sets/${input.params.id}`, {
            method: 'PUT',
            body: input.body
          })
        )
      )
    ),
    delete: appApi.routeSets.delete.handler(async ({ input }) =>
      unwrapJsonResponse<{ ok: boolean }>(handleDeleteRouteSet(input.params.id))
    )
  },
  regionPacks: {
    list: appApi.regionPacks.list.handler(async ({ input }): Promise<RegionPackListResponse> =>
      buildRegionPackListResponse(input.query)
    ),
    create: appApi.regionPacks.create.handler(async ({ input }) =>
      unwrapJsonResponse<{ regionPack: RegionPack }>(
        await handleCreateRegionPack(
          createInternalRequest('/v1/region-packs', {
            method: 'POST',
            body: input
          })
        )
      )
    ),
    get: appApi.regionPacks.get.handler(async ({ input }) => {
      const regionPack = repository.getRegionPack(input.params.id);

      if (!regionPack) {
        throw new ORPCError('NOT_FOUND', { message: 'Region pack not found' });
      }

      return regionPack;
    }),
    update: appApi.regionPacks.update.handler(async ({ input }) =>
      unwrapJsonResponse<{ regionPack: RegionPack }>(
        await handleUpdateRegionPack(
          input.params.id,
          createInternalRequest(`/v1/region-packs/${input.params.id}`, {
            method: 'PUT',
            body: input.body
          })
        )
      )
    ),
    delete: appApi.regionPacks.delete.handler(async ({ input }) =>
      unwrapJsonResponse<{ ok: boolean }>(handleDeleteRegionPack(input.params.id))
    )
  },
  checkProfiles: {
    list: appApi.checkProfiles.list.handler(async ({ input }): Promise<CheckProfileListResponse> =>
      buildCheckProfileListResponse(input.query)
    ),
    create: appApi.checkProfiles.create.handler(async ({ input }) =>
      unwrapJsonResponse<{ profile: CheckProfile }>(
        await handleCreateCheckProfile(
          createInternalRequest('/v1/check-profiles', {
            method: 'POST',
            body: input
          })
        )
      )
    ),
    get: appApi.checkProfiles.get.handler(async ({ input }) => {
      const profile = repository.getCheckProfile(input.params.id);

      if (!profile) {
        throw new ORPCError('NOT_FOUND', { message: 'Check profile not found' });
      }

      return profile;
    }),
    update: appApi.checkProfiles.update.handler(async ({ input }) =>
      unwrapJsonResponse<{ profile: CheckProfile }>(
        await handleUpdateCheckProfile(
          input.params.id,
          createInternalRequest(`/v1/check-profiles/${input.params.id}`, {
            method: 'PUT',
            body: input.body
          })
        )
      )
    ),
    delete: appApi.checkProfiles.delete.handler(async ({ input }) =>
      unwrapJsonResponse<{ ok: boolean; deletedRunCount: number }>(handleDeleteCheckProfile(input.params.id))
    ),
    baseline: {
      get: appApi.checkProfiles.baseline.get.handler(async ({ input }): Promise<CheckProfileBaselineResponse> =>
        unwrapJsonResponse(handleGetCheckProfileBaseline(input.params.id))
      ),
      set: appApi.checkProfiles.baseline.set.handler(async ({ input }): Promise<CheckProfileBaselineResponse> =>
        unwrapJsonResponse(
          await handleSetCheckProfileBaseline(
            input.params.id,
            createInternalRequest(`/v1/check-profiles/${input.params.id}/baseline`, {
              method: 'PUT',
              body: input.body
            })
          )
        )
      ),
      clear: appApi.checkProfiles.baseline.clear.handler(async ({ input }): Promise<CheckProfileBaselineResponse> =>
        unwrapJsonResponse(handleClearCheckProfileBaseline(input.params.id))
      )
    },
    runs: {
      list: appApi.checkProfiles.runs.list.handler(async ({ input }): Promise<CheckProfileRunListResponse> =>
        unwrapJsonResponse(handleListCheckProfileRuns(input.params.id, input.query))
      ),
      create: appApi.checkProfiles.runs.create.handler(async ({ input, context }): Promise<CheckProfileRunResponse> =>
        unwrapJsonResponse(
          await handleRunCheckProfile(
            input.params.id,
            createInternalRequest(`/v1/check-profiles/${input.params.id}/runs`, {
              method: 'POST',
              body: {},
              requesterIp: requesterIpFromContext(context)
            })
          )
        )
      ),
      get: appApi.checkProfiles.runs.get.handler(async ({ input }): Promise<CheckProfileRunDetailResponse> =>
        unwrapJsonResponse(handleGetCheckProfileRun(input.params.id, input.params.runId))
      ),
      compare: appApi.checkProfiles.runs.compare.handler(async ({ input }): Promise<CheckProfileComparisonResponse> => {
        const search = new URLSearchParams();

        if (input.query.against) {
          search.set('against', input.query.against);
        }

        if (input.query.againstRunId) {
          search.set('againstRunId', input.query.againstRunId);
        }

        const compareUrl = new URL(`http://control.internal/v1/check-profiles/${input.params.id}/runs/${input.params.runId}/compare`);
        compareUrl.search = search.toString();

        return unwrapJsonResponse(handleGetCheckProfileRunComparison(input.params.id, input.params.runId, compareUrl));
      })
    },
    compareLatest: appApi.checkProfiles.compareLatest.handler(async ({ input }): Promise<CheckProfileLatestComparisonResponse> =>
      unwrapJsonResponse(handleGetLatestCheckProfileComparison(input.params.id))
    ),
    compareBaseline: appApi.checkProfiles.compareBaseline.handler(async ({ input }): Promise<CheckProfileComparisonResponse> =>
      unwrapJsonResponse(handleGetBaselineCheckProfileComparison(input.params.id))
    ),
    report: appApi.checkProfiles.report.handler(async ({ input }): Promise<CheckProfileReportResponse> =>
      unwrapJsonResponse(handleGetCheckProfileReport(input.params.id))
    ),
    reportExport: appApi.checkProfiles.reportExport.handler(async ({ input }) =>
      buildExportResource({
        source: {
          type: 'check_report',
          checkId: input.params.id
        },
        format: input.body?.format ?? 'json'
      })
    )
  },
  comparisons: {
    list: appApi.comparisons.list.handler(async ({ input }): Promise<ComparisonListResponse> =>
      buildComparisonListResponse(input.query)
    )
  },
  analyses: {
    list: appApi.analyses.list.handler(async ({ input }): Promise<AnalysisListResponse> =>
      buildAnalysisListResponse(input.query)
    )
  },
  exports: {
    list: appApi.exports.list.handler(async ({ input }): Promise<ExportListResponse> =>
      buildExportListResponse(input.query)
    ),
    create: appApi.exports.create.handler(async ({ input }) => buildExportResource(input)),
    get: appApi.exports.get.handler(async ({ input }) => {
      const exportResource = repository.getExport(input.params.exportId);

      if (!exportResource) {
        throw new ORPCError('NOT_FOUND', { message: 'Export not found' });
      }

      return exportResource;
    })
  }
});

const opsRouter = opsApi.router({
  system: {
    health: opsApi.system.health.handler(async () => buildHealthPayload()),
    regions: opsApi.system.regions.handler(async () => ({
      regions: getRegionAvailability()
    }))
  },
  scheduler: {
    dispatch: opsApi.scheduler.dispatch.handler(async ({ input }): Promise<SchedulerDispatchResponse> => {
      const dispatchUrl = new URL('http://control.internal/v1/scheduler/dispatch');

      if (input.now) {
        dispatchUrl.searchParams.set('now', input.now);
      }

      return unwrapJsonResponse(
        await handleDispatchScheduledProfiles(
          createInternalRequest(`/v1/scheduler/dispatch${dispatchUrl.search}`, {
            method: 'POST'
          }),
          dispatchUrl
        )
      );
    })
  },
  jobs: {
    list: opsApi.jobs.list.handler(async ({ input }): Promise<JobListResponse> =>
      buildJobListResponse(input.query)
    ),
    create: opsApi.jobs.create.handler(async ({ input, context }) =>
      unwrapJsonResponse<{ job: LatencyJobDetail }>(
        await handleCreateJob(
          createInternalRequest('/v1/jobs', {
            method: 'POST',
            body: input,
            requesterIp: requesterIpFromContext(context)
          })
        )
      )
    ),
    get: opsApi.jobs.get.handler(async ({ input }) => {
      const job = repository.getJob(input.params.jobId);

      if (!job) {
        throw new ORPCError('NOT_FOUND', { message: 'Job not found' });
      }

      return job;
    }),
    stream: opsApi.jobs.stream.handler(async ({ input }) => {
      const job = repository.getJob(input.params.jobId);

      if (!job) {
        throw new ORPCError('NOT_FOUND', { message: 'Job not found' });
      }

      return {
        type: 'job.snapshot' as const,
        job
      };
    })
  }
});

const controlRpcHandler = new RPCHandler<OrpcContext>(controlRouter as never);
const publicRpcHandler = new RPCHandler<OrpcContext>(publicRouter as never);
const appRpcHandler = new RPCHandler<OrpcContext>(appRouter as never);
const opsRpcHandler = new RPCHandler<OrpcContext>(opsRouter as never);

let controlOpenApiDocumentPromise: Promise<unknown> | undefined;
let publicOpenApiDocumentPromise: Promise<unknown> | undefined;

const getControlOpenApiDocument = async () => {
  if (!controlOpenApiDocumentPromise) {
    controlOpenApiDocumentPromise = Promise.resolve(
      buildControlOpenApiDocument({
        title: 'Webperf Control API',
        version: '0.1.0',
        description:
          'Contract-first API for the self-hosted WebPerf API service. `/v1/*` remains the stable REST surface, while `/rpc/*` exposes the same procedures over oRPC.',
        serverUrl: '/'
      })
    );
  }

  return await controlOpenApiDocumentPromise;
};

const getPublicOpenApiDocument = async () => {
  if (!publicOpenApiDocumentPromise) {
    publicOpenApiDocumentPromise = Promise.resolve(
      buildPublicOpenApiDocument({
        title: 'Webperf Public API',
        version: '0.1.0',
        description:
          'Resource-oriented API for self-hosted Webperf. Internal job orchestration and scheduler controls stay behind dedicated app/ops RPC surfaces.',
        serverUrl: '/'
      })
    );
  }

  return await publicOpenApiDocumentPromise;
};

export type SelfhostControlServer = typeof server;

const shutdown = () => {
  repository.close();
  server.stop(true);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
