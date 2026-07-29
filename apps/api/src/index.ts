import type {
  AnalysisResource,
  AnalysisListResponse,
  BrowserAuditArtifactRef,
  BrowserAuditCapabilities,
  BrowserAuditListResponse,
  BrowserAuditResource,
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
  CreateBrowserAuditInput,
  CreateLatencyJobInput,
  CreatePropertyInput,
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
  RegionalExecutionRequest,
  RegionalExecutionResult,
  RegionalExecutionTargetResult,
  ReportExportFormat,
  ExportResource,
  ExportListResponse,
  ExecutionJob,
  ExecutionResourceContext,
  ExecutionResourceResult,
  RouteSet,
  RouteSetListResponse,
  SchedulerDispatchResponse,
  SetCheckProfileBaselineInput,
  UpdateCheckProfileInput,
  UpdatePropertyInput,
  UpdateRouteSetInput
} from '@webperf/contracts';
import {
  analysisListResponseSchema,
  analysisResourceSchema,
  appContract,
  browserAuditCapabilitiesSchema,
  browserAuditArtifactUploadGrantRequestSchema,
  browserAuditArtifactUploadGrantSchema,
  browserAuditArtifactKindSchema,
  browserAuditArtifactContentTypesForKind,
  browserAuditArtifactLimit,
  browserAuditArtifactRefSchema,
  browserAuditArtifactRegistryVersion,
  browserAuditListResponseSchema,
  browserAuditResourceSchema,
  checkProfileListResponseSchema,
  checkProfileRunListResponseSchema,
  comparisonListResponseSchema,
  createAnalysisInputSchema,
  createBrowserAuditInputSchema,
  createComparisonInputSchema,
  controlContract,
  createCheckProfileSchema,
  createExportInputSchema,
  createLatencyJobSchema,
  createPropertySchema,
  createRouteSetSchema,
  exportListResponseSchema,
  exportResourceSchema,
  executionJobFailRequestSchema,
  executionJobIdSchema,
  executionJobLeaseRequestSchema,
  executionJobOwnerRequestSchema,
  executionPayloadMaxBytes,
  executionFollowupsRequestSchema,
  executionFollowupsResponseSchema,
  executionResourceContextRequestSchema,
  executionResourceContextSchema,
  executionResourceResultRequestSchema,
  defaultBrowserAuditArtifactContentTypes,
  browserAuditExecutionPayloadSchema,
  networkProbeExecutionPayloadSchema,
  regionalExecutionPayloadMaxBytes,
  regionalExecutionProvenanceSchema,
  regionalExecutionRequestSchema,
  regionalExecutionResultSchema,
  regionalRuntimeCapabilitiesSchema,
  regionalRuntimeMaxBatchSize,
  regionalRuntimeMaxDeadlineMs,
  regionalRuntimeProtocolVersion,
  regionalRuntimeReplayWindowSeconds,
  webhookDeliveryExecutionPayloadSchema,
  jobListResponseSchema,
  listQuerySchema,
  propertyListResponseSchema,
  comparisonResourceSchema,
  reportExportFormatSchema,
  routeSetListResponseSchema,
  setCheckProfileBaselineSchema,
  opsContract,
  publicContract,
  updateCheckProfileSchema,
  updatePropertySchema,
  updateRouteSetSchema,
  runtimeLocationReportSchema,
  regionsResponseSchema,
  type RuntimeLocationReport,
  type RuntimeRegionId
} from '@webperf/contracts';
import { buildControlOpenApiDocument } from '@webperf/contracts/control-openapi';
import { buildPublicOpenApiDocument } from '@webperf/contracts/public-openapi';
import { buildRegionalRuntimeOpenApiDocument } from '@webperf/contracts/regional-runtime-openapi';
import {
  JsonBodyEmptyError,
  JsonBodyTooLargeError,
  readBoundedJson
} from './json-body';
import { implement, ORPCError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { isDeepStrictEqual } from 'node:util';
import {
  applyListQuery,
  createRegionalExecutionRequestDigest,
  createRegionalResultSignature,
  normalizeRegionalRequestConfig,
  parseListQueryFromSearchParams,
  resolveRuntimeLocation,
  validateMeasurementUrl,
  verifyRegionalExecutionSignature
} from '@webperf/domain-core';
import { parseSelfhostApiVars } from '@webperf/config/selfhost';
import {
  buildCheckProfileComparison,
  buildCheckProfileReportCsv,
  summarizeCheckProfileRunReport,
  summarizeTargets
} from '@webperf/report-core';
import { createSqliteJobRepository } from './repository';
import {
  ArtifactStoreValidationError,
  LocalBrowserAuditArtifactStore,
  normalizeArtifactFilename
} from './browser-audit-artifact-store';
import {
  issueBrowserAuditUploadToken,
  verifyBrowserAuditUploadToken
} from './browser-audit-upload-token';
import { authorizeApiRequest } from './auth';
import { describeSafeError } from './diagnostics';
import type { RegionalExecutionRecord } from './regional-runtime-record';
import {
  describeSchedulerError,
  dispatchScheduledChecks,
  runScheduler,
  type SchedulerLogger
} from '@webperf/domain-core';
import {
  isSensitiveHeaderName,
  redactJsonResponse,
  redactSensitiveData,
  redactedValue
} from './redaction';

type SelfhostRuntime = {
  host: string;
  port: number;
  databasePath: string;
  artifactsPath: string;
  artifactUploadBaseUrl?: string;
  maxArtifactBytes: number;
  artifactUploadTtlSeconds: number;
  retentionDays: number;
  migrationBackup: boolean;
  adminToken?: string;
  adminTokenNext?: string;
  internalSecret: string;
  internalSecretNext?: string;
  browserAuditBaseUrl?: string;
  runtimeLocation: RuntimeLocationReport;
  probeBaseUrl: string;
  maxTargetAttempts: number;
  schedulerMode: 'embedded' | 'external' | 'disabled';
  schedulerPollIntervalSeconds: number;
  runtimeMode: 'full' | 'regional-runtime';
  regionalRuntimeSecret?: string;
  regionalRuntimeSecretNext?: string;
  runtimeVersion?: string;
  runtimeImageDigest?: string;
  probeImageDigest?: string;
};

type MutableTarget = LatencyJobTarget;
type MutableJob = LatencyJobDetail;
type ExecutionJobMutationAction = 'start' | 'renew' | 'complete' | 'fail';
type ExecutionJobResourceAction =
  | 'context'
  | 'artifact-upload-grant'
  | 'result'
  | 'followups';
const executionJobMutationPathPattern =
  /^\/internal\/execution-jobs\/([^/]+)\/(start|renew|complete|fail)$/;
const executionJobResourcePathPattern =
  /^\/internal\/execution-jobs\/([^/]+)\/(context|artifact-upload-grant|result|followups)$/;
const browserAuditArtifactUploadPathPattern =
  /^\/internal\/browser-audits\/([^/]+)\/artifacts$/;
const browserAuditArtifactDownloadPathPattern =
  /^\/v1\/browser-audits\/([^/]+)\/artifacts\/([^/]+)$/;
const regionalExecutionPathPattern = /^\/v1\/regional-executions\/([^/]+)$/;
const regionalRetentionPruneIntervalMs = 60 * 60 * 1_000;
let nextRegionalRetentionPruneAt = Date.now() + regionalRetentionPruneIntervalMs;
type CreatedProfileJob = {
  routeId: string;
  routeLabel: string;
  url: string;
  job: MutableJob;
};

export const runtime = parseRuntime(process.env);

// Phase 3: abort controller for the embedded scheduler loop, declared early
// at module scope so both the startup block and shutdown() can reach it.
let embeddedSchedulerAbort: AbortController | null = null;
export const repository = createSqliteJobRepository({
  databasePath: runtime.databasePath,
  encryptionSecret: runtime.internalSecret,
  encryptionSecretNext: runtime.internalSecretNext,
  backupBeforeMigrations: runtime.migrationBackup
});
export const artifactStore = new LocalBrowserAuditArtifactStore(runtime.artifactsPath);

repository.pruneRetainedData(runtime.retentionDays);
await artifactStore.reconcile(new Set(repository.listBrowserAuditArtifactStorageKeys()));

const buildHealthPayload = () => ({
  service: 'webperf-api',
  ok: true,
  runtimeMode: runtime.runtimeMode,
  runtimeLocation: runtime.runtimeLocation,
  probeBaseUrl: runtime.probeBaseUrl,
  maxTargetAttempts: runtime.maxTargetAttempts,
  storage: {
    kind: 'sqlite' as const,
    databasePath: runtime.databasePath,
    retainedDays: runtime.retentionDays,
    persistedJobs: repository.countJobs()
  },
  artifacts: {
    kind: 'local-filesystem' as const,
    path: runtime.artifactsPath,
    maxArtifactBytes: runtime.maxArtifactBytes,
    uploadTtlSeconds: runtime.artifactUploadTtlSeconds
  },
  savedConfigs: {
    properties: repository.listProperties().length,
    routeSets: repository.listRouteSets().length,
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

const buildProcessHealthPayload = () => ({
  service: 'webperf-api',
  ok: true
});

const buildPublicCapabilitiesPayload = () => ({
  deploymentModel: 'selfhost' as const,
  runtimeMode: runtime.runtimeMode,
  features: {
    managedRegions: false,
    scheduledChecks: runtime.runtimeMode !== 'regional-runtime',
    baselineCompare: runtime.runtimeMode !== 'regional-runtime',
    reportExports: runtime.runtimeMode !== 'regional-runtime',
    webhookAlerts: runtime.runtimeMode !== 'regional-runtime',
    browserAuditDirectRun: runtime.runtimeMode !== 'regional-runtime' && Boolean(runtime.browserAuditBaseUrl),
    aiAnalyses: false,
    openApi: true,
    appRpc: true,
    opsRpc: true
  },
  metrics: {
    networkProbe: {
      version: 'v1' as const,
      dnsTiming: true,
      tcpTiming: false,
      tlsTiming: false,
      responseHeaderTiming: true,
      bodySampleTiming: false,
      tlsMetadata: false
    }
  }
});

const buildRegionalRuntimeMetadata = () => ({
  runtime: {
    version: runtime.runtimeVersion ?? null,
    imageDigest: runtime.runtimeImageDigest ?? null
  },
  runner: {
    id: 'probe-rs',
    implementation: 'rust',
    imageDigest: runtime.probeImageDigest ?? null
  }
});

const buildRegionalRuntimeCapabilitiesPayload = () =>
  regionalRuntimeCapabilitiesSchema.parse({
    protocolVersion: regionalRuntimeProtocolVersion,
    regionId: runtime.runtimeLocation.regionId,
    regionLabel: runtime.runtimeLocation.label,
    runnerTypes: ['network_probe'],
    maxBatchSize: regionalRuntimeMaxBatchSize,
    maxDeadlineMs: regionalRuntimeMaxDeadlineMs,
    maxAttempts: runtime.maxTargetAttempts,
    ...buildRegionalRuntimeMetadata()
  });

const buildRegionalExecutionProvenance = () =>
  regionalExecutionProvenanceSchema.parse({
    regionId: runtime.runtimeLocation.regionId,
    runnerType: 'network_probe',
    ...buildRegionalRuntimeMetadata()
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

const buildCheckProfileListResponse = (query?: ListQuery): CheckProfileListResponse =>
  checkProfileListResponseSchema.parse({
    checkProfiles: applyListQuery(repository.listCheckProfiles(), query, (profile) => [
      profile.id,
      profile.name,
      profile.note,
      profile.propertyId,
      profile.routeSetId
    ]).items,
    pageInfo: applyListQuery(repository.listCheckProfiles(), query, (profile) => [
      profile.id,
      profile.name,
      profile.note,
      profile.propertyId,
      profile.routeSetId
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
      job.region
    ]).items,
    pageInfo: applyListQuery(repository.listJobs(), query, (job) => [
      job.id,
      job.url,
      job.status,
      job.note,
      job.requesterIp,
      job.region
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

const buildBrowserAuditListResponse = (query?: ListQuery): BrowserAuditListResponse =>
  browserAuditListResponseSchema.parse({
    browserAudits: applyListQuery(repository.listBrowserAudits(), query, (audit) => [
      audit.id,
      audit.targetUrl,
      audit.region,
      audit.status,
      audit.requestedAt,
      audit.completedAt,
      audit.error
    ]).items,
    pageInfo: applyListQuery(repository.listBrowserAudits(), query, (audit) => [
      audit.id,
      audit.targetUrl,
      audit.region,
      audit.status,
      audit.requestedAt,
      audit.completedAt,
      audit.error
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
      : JSON.stringify(redactSensitiveData(report), null, 2);

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
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(redactSensitiveData(payload))}\n\n`));

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

const routeRequest = async (request: Request) => {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (
      pathname === '/openapi/regional-runtime.json'
      && request.method === 'GET'
      && runtime.runtimeMode === 'regional-runtime'
    ) {
      return json(await getRegionalRuntimeOpenApiDocument());
    }

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

    if (pathname === '/health') {
      return json(buildProcessHealthPayload());
    }

    if (
      pathname === '/v1/regional-capabilities'
      && request.method === 'GET'
      && runtime.runtimeMode === 'regional-runtime'
    ) {
      return json(buildRegionalRuntimeCapabilitiesPayload());
    }

    if (
      pathname === '/v1/regional-executions'
      && request.method === 'POST'
      && runtime.runtimeMode === 'regional-runtime'
    ) {
      return handleCreateRegionalExecution(request);
    }

    const regionalExecutionMatch = pathname.match(regionalExecutionPathPattern);
    if (
      regionalExecutionMatch?.[1]
      && request.method === 'GET'
      && runtime.runtimeMode === 'regional-runtime'
    ) {
      return handleGetRegionalExecution(decodePathSegment(regionalExecutionMatch[1]));
    }

    if (
      regionalExecutionMatch?.[1]
      && request.method === 'DELETE'
      && runtime.runtimeMode === 'regional-runtime'
    ) {
      return handleCancelRegionalExecution(decodePathSegment(regionalExecutionMatch[1]));
    }

    if (pathname === '/v1/health') {
      return json(buildHealthPayload());
    }

    if (pathname === '/v1/regions' && request.method === 'GET') {
      return json({
        runtimeLocation: getRuntimeLocationReport()
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

    // Phase 1 of issue #14 removed the multi-region Region Pack / Region Set
    // resources. One standalone deployment owns a single runtime location
    // reported via /v1/regions. These routes now return 410 Gone so stale
    // clients fail fast instead of receiving a silent fallback.
    if (
      (pathname === '/v1/region-packs' || pathname === '/v1/region-sets')
      && (request.method === 'GET' || request.method === 'POST')
    ) {
      return json(
        {
          error: 'Region packs and region sets were removed in Phase 1 of issue #14. One standalone deployment measures from one runtime location reported by GET /v1/regions.'
        },
        { status: 410 }
      );
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

    if (pathname === '/v1/browser-audits' && request.method === 'GET') {
      return json(buildBrowserAuditListResponse(parseListQueryFromSearchParams(url.searchParams)));
    }

    if (pathname === '/v1/browser-audits' && request.method === 'POST') {
      return handleCreateBrowserAudit(request);
    }

    if (pathname === '/v1/scheduler/dispatch' && request.method === 'POST') {
      return handleDispatchScheduledProfiles(request, url);
    }

    if (pathname === '/internal/execution-jobs/claim' && request.method === 'POST') {
      return withExecutionTransportErrors('claim', () => handleClaimExecutionJob(request));
    }

    const browserAuditArtifactUploadMatch = pathname.match(
      browserAuditArtifactUploadPathPattern
    );
    if (browserAuditArtifactUploadMatch?.[1] && request.method === 'POST') {
      return handleBrowserAuditArtifactUpload(
        browserAuditArtifactUploadMatch[1],
        request,
        url
      );
    }

    const executionResourceMatch = pathname.match(executionJobResourcePathPattern);
    if (executionResourceMatch?.[1] && executionResourceMatch[2] && request.method === 'POST') {
      const executionJobId = executionJobIdSchema.safeParse(executionResourceMatch[1]);

      if (!executionJobId.success) {
        return json(
          { error: 'Invalid execution job ID' },
          { status: 400, headers: { 'cache-control': 'no-store' } }
        );
      }

      const action = executionResourceMatch[2] as ExecutionJobResourceAction;
      return withExecutionTransportErrors(
        action,
        () => handleExecutionResourceOperation(executionJobId.data, action, request)
      );
    }

    const executionJobMatch = pathname.match(executionJobMutationPathPattern);
    if (executionJobMatch?.[1] && executionJobMatch[2] && request.method === 'POST') {
      const executionJobId = executionJobIdSchema.safeParse(executionJobMatch[1]);

      if (!executionJobId.success) {
        return json(
          { error: 'Invalid execution job ID' },
          { status: 400, headers: { 'cache-control': 'no-store' } }
        );
      }

      const action = executionJobMatch[2] as ExecutionJobMutationAction;
      return withExecutionTransportErrors(
        action,
        () => handleExecutionJobMutation(executionJobId.data, action, request)
      );
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

    // Phase 1 of issue #14: per-id Region Pack / Region Set routes return
    // 410 Gone. The collection routes above share the same response.
    const regionPackIdMatch = pathname.match(/^\/v1\/(?:region-packs|region-sets)\/([^/]+)$/);
    if (regionPackIdMatch?.[1]) {
      return json(
        {
          error: 'Region packs and region sets were removed in Phase 1 of issue #14.'
        },
        { status: 410 }
      );
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

    const browserAuditArtifactDownloadMatch = pathname.match(
      browserAuditArtifactDownloadPathPattern
    );
    if (
      browserAuditArtifactDownloadMatch?.[1]
      && browserAuditArtifactDownloadMatch[2]
      && request.method === 'GET'
    ) {
      return handleBrowserAuditArtifactDownload(
        browserAuditArtifactDownloadMatch[1],
        browserAuditArtifactDownloadMatch[2]
      );
    }

    const browserAuditMatch = pathname.match(/^\/v1\/browser-audits\/([^/]+)$/);
    if (browserAuditMatch?.[1] && request.method === 'GET') {
      return handleGetBrowserAudit(browserAuditMatch[1]);
    }

    return json(
      {
        ok: false,
        message:
          'Use /health, /v1/capabilities, /v1/sites, /v1/route-groups, /v1/checks, /v1/checks/:checkId/runs, /v1/runs/:runId, /v1/comparisons, /v1/exports, /v1/analyses, or /v1/browser-audits'
      },
      { status: 404 }
    );
};

const decodePathSegment = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
};

const isRegionalRuntimeSurface = (pathname: string) =>
  pathname === '/v1/regional-capabilities'
  || pathname === '/v1/regional-executions'
  || pathname === '/openapi/regional-runtime.json'
  || regionalExecutionPathPattern.test(pathname);

const isRegionalInternalExecutionSurface = (pathname: string, method: string) => {
  if (method !== 'POST') {
    return false;
  }

  if (pathname === '/internal/execution-jobs/claim') {
    return true;
  }

  if (executionJobMutationPathPattern.test(pathname)) {
    return true;
  }

  const resourceMatch = pathname.match(executionJobResourcePathPattern);
  return resourceMatch?.[2] === 'context' || resourceMatch?.[2] === 'result';
};

const isRuntimeSurfaceAllowed = (pathname: string, method: string) => {
  if (runtime.runtimeMode === 'full') {
    return !isRegionalRuntimeSurface(pathname);
  }

  if (pathname.startsWith('/internal/')) {
    return isRegionalInternalExecutionSurface(pathname, method);
  }

  if (
    pathname === '/health'
    || pathname === '/v1/regional-capabilities'
    || pathname === '/openapi/regional-runtime.json'
  ) {
    return method === 'GET';
  }

  if (pathname === '/v1/regional-executions') {
    return method === 'POST';
  }

  return regionalExecutionPathPattern.test(pathname)
    && (method === 'GET' || method === 'DELETE');
};

export const server = Bun.serve({
  hostname: runtime.host,
  port: runtime.port,
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (!isRuntimeSurfaceAllowed(pathname, request.method)) {
      return json({ error: 'Not found' }, { status: 404 });
    }
    const usesScopedArtifactToken = request.method === 'POST'
      && browserAuditArtifactUploadPathPattern.test(pathname);
    const unauthorized = usesScopedArtifactToken
      ? null
      : authorizeApiRequest(request, runtime);

    if (unauthorized) {
      return unauthorized;
    }

    let routedResponse: Response;
    try {
      routedResponse = await routeRequest(request);
    } catch (error) {
      if (!isRegionalRuntimeSurface(pathname)) {
        throw error;
      }
      const incidentId = logRegionalRuntimeResponseFailure(error);
      routedResponse = json(
        {
          error: 'Regional runtime request failed',
          incidentId
        },
        { status: 500 }
      );
    }
    const response = (
      isExecutionTransportPath(pathname)
      || isRegionalRuntimeSurface(pathname)
      || (request.method === 'GET' && browserAuditArtifactDownloadPathPattern.test(pathname))
    )
      ? routedResponse
      : await redactJsonResponse(routedResponse);
    const cacheBoundedResponse = isRegionalRuntimeSurface(pathname)
      ? withNoStore(response)
      : response;
    return addCompatibilityDeprecationHeaders(request, cacheBoundedResponse);
  }
});

console.log(
  JSON.stringify({
    service: 'webperf-api',
    listeningOn: `http://${runtime.host}:${runtime.port}`,
    runtimeLocation: runtime.runtimeLocation,
    probeBaseUrl: runtime.probeBaseUrl,
    databasePath: runtime.databasePath,
    artifactsPath: runtime.artifactsPath,
    retainedDays: runtime.retentionDays,
    schedulerMode: runtime.schedulerMode,
    runtimeMode: runtime.runtimeMode
  })
);

// Phase 3 of issue #14: when schedulerMode is 'embedded', run the scheduler
// dispatch loop inside the API process so the default standalone topology
// needs no separate scheduler container. The loop calls the same internal
// dispatch endpoint as the standalone scheduler, using loopback origin and
// the internal secret already present in the API process.
// In regional-runtime mode the scheduler is always disabled — a regional
// runtime only accepts Cloud-submitted execution requests, not self-host
// scheduled Checks.
if (runtime.schedulerMode === 'embedded' && runtime.runtimeMode !== 'regional-runtime') {
  const schedulerBaseLogFields = {
    service: 'webperf-api',
    component: 'embedded-scheduler'
  };
  const schedulerLogger: SchedulerLogger = {
    info: (event) => console.log(JSON.stringify({
      ...schedulerBaseLogFields,
      level: 'info',
      ...event
    })),
    error: (event) => console.error(JSON.stringify({
      ...schedulerBaseLogFields,
      level: 'error',
      ...event
    }))
  };

  embeddedSchedulerAbort = new AbortController();
  const schedulerPollIntervalMs = runtime.schedulerPollIntervalSeconds * 1_000;

  schedulerLogger.info({
    event: 'embedded_scheduler_started',
    pollIntervalSeconds: runtime.schedulerPollIntervalSeconds
  });

  // The embedded scheduler dispatches to this API process internally.
  // Normalize the bind address into a URL-safe connect target:
  // - wildcard binds (0.0.0.0 / ::) connect via IPv4 loopback
  // - IPv6 literals are wrapped in brackets for URL syntax
  const rawHost = runtime.host;
  const isWildcard = rawHost === '0.0.0.0' || rawHost === '::' || rawHost === '[::]';
  const isIPv6Literal = rawHost.includes(':') && !rawHost.startsWith('[');
  const dispatchHost = isWildcard
    ? '127.0.0.1'
    : isIPv6Literal
      ? `[${rawHost}]`
      : rawHost;

  runScheduler({
    dispatch: (signal) => dispatchScheduledChecks({
      apiBaseUrl: `http://${dispatchHost}:${runtime.port}`,
      internalSecret: runtime.internalSecret,
      signal
    }),
    pollIntervalMs: schedulerPollIntervalMs,
    signal: embeddedSchedulerAbort?.signal,
    logger: schedulerLogger
  }).catch((error) => {
    schedulerLogger.error({
      event: 'embedded_scheduler_fatal',
      ...describeSchedulerError(error)
    });
  });

  const stopEmbeddedScheduler = (signal: NodeJS.Signals) => {
    embeddedSchedulerAbort?.abort(new Error(`Embedded scheduler shutdown on ${signal}`));
  };
  process.once('SIGINT', stopEmbeddedScheduler);
  process.once('SIGTERM', stopEmbeddedScheduler);
}

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

  try {
    createNetworkExecutionResource([job], null, null);
  } catch (error) {
    const incidentId = logExecutionCreationFailure('manual_job_create', error, job.id);
    return json(
      {
        error: 'Failed to queue job',
        incidentId
      },
      { status: 500 }
    );
  }

  return json(
    {
      job
    },
    { status: 201 }
  );
}

async function handleCreateRegionalExecution(request: Request) {
  const body = await parseJsonBody<RegionalExecutionRequest>(
    request,
    regionalExecutionPayloadMaxBytes
  );

  if (!body.ok) {
    return body.response;
  }

  const parsed = regionalExecutionRequestSchema.safeParse(body.data);
  if (!parsed.success) {
    return json(
      {
        error: 'Invalid regional execution payload',
        issues: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  const timestampMs = Date.parse(parsed.data.timestamp);
  if (!Number.isFinite(timestampMs)) {
    return regionalRuntimeUnauthorized();
  }
  const replayWindowMs = regionalRuntimeReplayWindowSeconds * 1_000;
  if (Math.abs(Date.now() - timestampMs) > replayWindowMs) {
    return regionalRuntimeUnauthorized();
  }

  const signingSecret = parsed.data.keyVersion === 'current'
    ? runtime.regionalRuntimeSecret
    : runtime.regionalRuntimeSecretNext;
  if (!signingSecret) {
    return regionalRuntimeUnauthorized();
  }

  const { signature, ...unsignedRequest } = parsed.data;
  if (!await verifyRegionalExecutionSignature(signingSecret, unsignedRequest, signature)) {
    return regionalRuntimeUnauthorized();
  }

  const requestDigest = await createRegionalExecutionRequestDigest(unsignedRequest);
  const existing = repository.getRegionalExecution(parsed.data.idempotencyKey);
  if (existing) {
    if (existing.requestDigest !== requestDigest) {
      return regionalExecutionConflict();
    }
    const current = expireRegionalExecutionIfNeeded(existing);
    return json(await buildSignedRegionalExecutionResult(current));
  }

  if (parsed.data.maxAttempts > runtime.maxTargetAttempts) {
    return json(
      {
        error: `maxAttempts exceeds this runtime's limit of ${runtime.maxTargetAttempts}`
      },
      { status: 400 }
    );
  }

  for (const target of parsed.data.targets) {
    try {
      validateMeasurementUrl(target.url);
    } catch {
      return json(
        {
          error: 'Regional execution contains a blocked or invalid target URL',
          targetId: target.targetId
        },
        { status: 400 }
      );
    }
  }

  const acceptedAt = new Date().toISOString();
  const deadlineAt = new Date(
    Date.parse(acceptedAt) + parsed.data.deadlineMs
  ).toISOString();
  const jobIdPrefix = `reg_${requestDigest.slice(0, 32)}`;
  const jobs = parsed.data.targets.map((target, index) =>
    createJobRecord({
      id: `${jobIdPrefix}_${index}`,
      url: target.url,
      note: `Regional execution target ${target.targetId}`,
      requestConfig: target.request,
      requestSource: 'regional-runtime',
      monitorPolicy: undefined,
      requesterIp: null,
      maxAttempts: parsed.data.maxAttempts
    })
  );
  const resources: ReturnType<typeof buildNetworkExecutionResourceInput>[] = [];
  const targetLinks: RegionalExecutionRecord['targetLinks'] = [];

  for (const [index, job] of jobs.entries()) {
    const executionJobId = `exec_${job.id}`;
    resources.push(buildNetworkExecutionResourceInput([job], null, null, {
      resourceId: parsed.data.idempotencyKey,
      executionJobId,
      deadlineAt,
      regionalExecutionId: parsed.data.idempotencyKey
    }));
    const requestTarget = parsed.data.targets[index];
    if (!requestTarget) {
      throw new Error('Regional execution target mapping is incomplete');
    }
    targetLinks.push({
      targetId: requestTarget.targetId,
      jobId: job.id,
      executionJobId
    });
  }

  const record: RegionalExecutionRecord = {
    id: parsed.data.idempotencyKey,
    requestDigest,
    request: parsed.data,
    provenance: buildRegionalExecutionProvenance(),
    targetLinks,
    acceptedAt,
    deadlineAt,
    cancelledAt: null,
    deadlineExceededAt: null,
    createdAt: acceptedAt,
    updatedAt: acceptedAt
  };

  let persisted: ReturnType<typeof repository.createRegionalExecution>;
  try {
    // Regional records and their linked jobs/execution rows must cross the
    // retention boundary together so a retained idempotency key can never
    // reconstruct from partially deleted results.
    const now = Date.now();
    if (now >= nextRegionalRetentionPruneAt) {
      repository.pruneRetainedData(runtime.retentionDays);
      nextRegionalRetentionPruneAt = now + regionalRetentionPruneIntervalMs;
    }
    persisted = repository.createRegionalExecution({ record, resources });
  } catch (error) {
    const incidentId = logRegionalExecutionCreationFailure(error, record.id);
    return json(
      {
        error: 'Failed to queue regional execution',
        incidentId
      },
      { status: 500 }
    );
  }

  if (persisted.record.requestDigest !== requestDigest) {
    return regionalExecutionConflict();
  }

  return json(
    await buildSignedRegionalExecutionResult(
      expireRegionalExecutionIfNeeded(persisted.record)
    ),
    { status: persisted.created ? 202 : 200 }
  );
}

async function handleGetRegionalExecution(idempotencyKey: string) {
  const record = repository.getRegionalExecution(idempotencyKey);
  if (!record) {
    return json({ error: 'Regional execution not found' }, { status: 404 });
  }

  return json(await buildSignedRegionalExecutionResult(
    expireRegionalExecutionIfNeeded(record)
  ));
}

async function handleCancelRegionalExecution(idempotencyKey: string) {
  const stored = repository.getRegionalExecution(idempotencyKey);
  if (!stored) {
    return json({ error: 'Regional execution not found' }, { status: 404 });
  }

  const record = expireRegionalExecutionIfNeeded(stored);
  const cancelled = repository.terminateRegionalExecution({
    id: record.id,
    reason: 'cancelled'
  }) ?? record;
  return json(await buildSignedRegionalExecutionResult(cancelled));
}

/**
 * Lazily enforces an accepted execution deadline.
 *
 * Regional runtimes do not run a scheduler, so status reads intentionally
 * persist deadline expiry and cancel any still-leased jobs. The executor also
 * enforces the same deadline while work is active.
 */
function expireRegionalExecutionIfNeeded(record: RegionalExecutionRecord) {
  if (
    record.cancelledAt
    || record.deadlineExceededAt
    || Date.parse(record.deadlineAt) > Date.now()
  ) {
    return record;
  }

  return repository.terminateRegionalExecution({
    id: record.id,
    reason: 'deadline_exceeded'
  }) ?? record;
}

async function buildSignedRegionalExecutionResult(
  record: RegionalExecutionRecord
): Promise<RegionalExecutionResult> {
  const targets = record.targetLinks.map((link) =>
    buildRegionalExecutionTargetResult(record, link)
  );
  const terminal = targets.every((target) =>
    ['succeeded', 'failed', 'cancelled'].includes(target.status)
  );
  let status: RegionalExecutionResult['status'];
  if (record.deadlineExceededAt) {
    status = 'failed';
  } else if (record.cancelledAt) {
    status = 'cancelled';
  } else if (targets.every((target) => target.status === 'succeeded')) {
    status = 'succeeded';
  } else if (terminal) {
    status = 'failed';
  } else if (targets.some((target) => target.status !== 'queued')) {
    status = 'running';
  } else {
    status = 'queued';
  }
  const completionCandidates = targets
    .map((target) => target.finishedAt)
    .filter((value): value is string => value != null)
    .sort();
  const completedAt = ['succeeded', 'failed', 'cancelled'].includes(status)
    ? record.cancelledAt
      ?? record.deadlineExceededAt
      ?? completionCandidates.at(-1)
      ?? record.updatedAt
    : null;
  const unsignedResult = regionalExecutionResultSchema.omit({
    signature: true
  }).parse({
    idempotencyKey: record.id,
    status,
    targets,
    provenance: record.provenance,
    acceptedAt: record.acceptedAt,
    completedAt,
    keyVersion:
      record.request.keyVersion === 'next' && runtime.regionalRuntimeSecretNext
        ? 'next'
        : 'current'
  });
  const signingSecret = unsignedResult.keyVersion === 'next'
    ? runtime.regionalRuntimeSecretNext
    : runtime.regionalRuntimeSecret;
  if (!signingSecret) {
    throw new Error('Regional runtime signing secret is unavailable');
  }

  return regionalExecutionResultSchema.parse({
    ...unsignedResult,
    signature: await createRegionalResultSignature(signingSecret, unsignedResult)
  });
}

function buildRegionalExecutionTargetResult(
  record: RegionalExecutionRecord,
  link: RegionalExecutionRecord['targetLinks'][number]
): RegionalExecutionTargetResult {
  const job = repository.getJob(link.jobId);
  const target = job?.targets[0] ?? null;
  const executionJob = repository.getExecutionJob(link.executionJobId);
  let status: RegionalExecutionTargetResult['status'];
  // Result persistence happens before the executor commits the terminal queue
  // transition. Keep a finished measurement non-terminal until both records
  // agree so Cloud never observes success that can later regress.
  if (
    executionJob?.status === 'succeeded'
    && target?.status === 'succeeded'
  ) {
    status = 'succeeded';
  } else if (
    executionJob?.status === 'succeeded'
    && target?.status === 'failed'
  ) {
    status = 'failed';
  } else if (record.deadlineExceededAt) {
    status = 'failed';
  } else if (record.cancelledAt || executionJob?.status === 'cancelled') {
    status = 'cancelled';
  } else if (
    executionJob?.status === 'failed'
    || executionJob?.status === 'succeeded'
  ) {
    status = 'failed';
  } else if (
    target?.status === 'measuring'
    || target?.status === 'succeeded'
    || target?.status === 'failed'
    || executionJob?.status === 'leased'
    || executionJob?.status === 'running'
  ) {
    status = 'running';
  } else {
    status = 'queued';
  }
  const executionError = executionJob?.error;
  const { errorCode, errorMessage } = resolveRegionalExecutionError({
    deadlineExceeded: record.deadlineExceededAt != null,
    status,
    executionJobStatus: executionJob?.status,
    targetStatus: target?.status,
    targetErrorCode: target?.errorCode ?? null,
    targetErrorMessage: target?.errorMessage ?? null,
    executionErrorCode: executionError?.code ?? null,
    executionErrorMessage: executionError?.message ?? null
  });
  const finishedAt = resolveRegionalTargetFinishedAt({
    status,
    cancelledAt: record.cancelledAt,
    deadlineExceededAt: record.deadlineExceededAt,
    targetFinishedAt: target?.finishedAt ?? null,
    executionCompletedAt: executionJob?.completedAt ?? null
  });

  return {
    targetId: link.targetId,
    status,
    region: record.provenance.regionId,
    latencyMs: target?.latencyMs == null ? null : Math.round(target.latencyMs),
    statusCode: target?.statusCode ?? null,
    success: target?.success ?? null,
    errorCode: errorCode?.slice(0, 120) ?? null,
    errorMessage: errorMessage?.slice(0, 1_000) ?? null,
    startedAt: target?.startedAt ?? null,
    finishedAt
  };
}

const resolveRegionalTargetFinishedAt = ({
  status,
  cancelledAt,
  deadlineExceededAt,
  targetFinishedAt,
  executionCompletedAt
}: {
  status: RegionalExecutionTargetResult['status'];
  cancelledAt: string | null;
  deadlineExceededAt: string | null;
  targetFinishedAt: string | null;
  executionCompletedAt: string | null;
}) => {
  if (status === 'cancelled') {
    return cancelledAt ?? executionCompletedAt ?? targetFinishedAt;
  }
  if (deadlineExceededAt && status === 'failed') {
    return deadlineExceededAt;
  }
  if (targetFinishedAt) {
    return targetFinishedAt;
  }
  return status === 'succeeded' || status === 'failed'
    ? executionCompletedAt
    : null;
};

const resolveRegionalExecutionError = ({
  deadlineExceeded,
  status,
  executionJobStatus,
  targetStatus,
  targetErrorCode,
  targetErrorMessage,
  executionErrorCode,
  executionErrorMessage
}: {
  deadlineExceeded: boolean;
  status: RegionalExecutionTargetResult['status'];
  executionJobStatus: ExecutionJob['status'] | undefined;
  targetStatus: LatencyJobTarget['status'] | undefined;
  targetErrorCode: string | null;
  targetErrorMessage: string | null;
  executionErrorCode: string | null;
  executionErrorMessage: string | null;
}) => {
  if (deadlineExceeded && status === 'failed') {
    return {
      errorCode: 'regional_execution_deadline_exceeded',
      errorMessage: 'Regional execution exceeded its accepted deadline'
    };
  }
  if (
    executionJobStatus === 'succeeded'
    && targetStatus !== 'succeeded'
    && targetStatus !== 'failed'
  ) {
    return {
      errorCode: 'regional_result_missing',
      errorMessage: 'Regional execution completed without a persisted measurement result'
    };
  }
  if (status === 'failed') {
    return {
      errorCode: targetErrorCode ?? executionErrorCode ?? 'regional_execution_failed',
      errorMessage: targetErrorMessage
        ?? executionErrorMessage
        ?? 'Regional execution failed before producing a measurement'
    };
  }
  return {
    errorCode: targetErrorCode,
    errorMessage: targetErrorMessage
  };
};

const regionalRuntimeUnauthorized = () => json(
  { error: 'Unauthorized regional execution request' },
  {
    status: 401,
    headers: {
      'cache-control': 'no-store',
      'www-authenticate': 'Bearer realm="webperf-regional-runtime"'
    }
  }
);

const regionalExecutionConflict = () => json(
  { error: 'Idempotency key already belongs to a different regional execution' },
  { status: 409 }
);

function logRegionalExecutionCreationFailure(error: unknown, resourceId: string) {
  const incidentId = crypto.randomUUID();
  console.error(JSON.stringify({
    service: 'webperf-api',
    event: 'regional_execution_creation_failed',
    resourceId,
    incidentId,
    ...describeSafeError(error)
  }));
  return incidentId;
}

function logRegionalRuntimeResponseFailure(error: unknown) {
  const incidentId = crypto.randomUUID();
  console.error(JSON.stringify({
    service: 'webperf-api',
    event: 'regional_runtime_response_failed',
    incidentId,
    ...describeSafeError(error)
  }));
  return incidentId;
}

async function handleClaimExecutionJob(request: Request) {
  const body = await parseExecutionTransportBody(
    request,
    executionJobLeaseRequestSchema,
    'Invalid execution lease request'
  );

  if (!body.ok) {
    return body.response;
  }

  const executionJob = repository.claimExecutionJob(body.data);

  if (!executionJob) {
    return new Response(null, {
      status: 204,
      headers: { 'cache-control': 'no-store' }
    });
  }

  return json(executionJob, {
    status: 200,
    headers: { 'cache-control': 'no-store' }
  });
}

async function handleExecutionJobMutation(
  executionJobId: string,
  action: ExecutionJobMutationAction,
  request: Request
) {
  if (action === 'start' || action === 'renew') {
    const body = await parseExecutionTransportBody(
      request,
      executionJobLeaseRequestSchema,
      'Invalid execution lease request'
    );

    if (!body.ok) {
      return body.response;
    }

    const executionJob = action === 'start'
      ? repository.markExecutionJobRunning({ id: executionJobId, ...body.data })
      : repository.renewExecutionJobLease({ id: executionJobId, ...body.data });
    return executionJob
      ? json(executionJob, { headers: { 'cache-control': 'no-store' } })
      : executionLeaseConflict();
  }

  if (action === 'complete') {
    const body = await parseExecutionTransportBody(
      request,
      executionJobOwnerRequestSchema,
      'Invalid execution owner request'
    );

    if (!body.ok) {
      return body.response;
    }

    const executionJob = repository.completeExecutionJob({
      id: executionJobId,
      leaseOwner: body.data.leaseOwner
    });
    return executionJob
      ? json(executionJob, { headers: { 'cache-control': 'no-store' } })
      : executionLeaseConflict();
  }

  const body = await parseExecutionTransportBody(
    request,
    executionJobFailRequestSchema,
    'Invalid execution failure request'
  );

  if (!body.ok) {
    return body.response;
  }

  const executionJob = repository.failExecutionJob({
    id: executionJobId,
    ...body.data
  });
  return executionJob
    ? json(executionJob, { headers: { 'cache-control': 'no-store' } })
    : executionLeaseConflict();
}

async function handleExecutionResourceOperation(
  executionJobId: string,
  action: ExecutionJobResourceAction,
  request: Request
) {
  if (action === 'context') {
    const body = await parseExecutionTransportBody(
      request,
      executionResourceContextRequestSchema,
      'Invalid execution context request'
    );

    if (!body.ok) {
      return body.response;
    }

    const executionJob = getOwnedRunningExecutionJob(executionJobId, body.data.leaseOwner);
    return executionJob
      ? json(buildExecutionResourceContext(executionJob), {
          headers: { 'cache-control': 'no-store' }
        })
      : executionLeaseConflict();
  }

  if (action === 'artifact-upload-grant') {
    const body = await parseExecutionTransportBody(
      request,
      browserAuditArtifactUploadGrantRequestSchema,
      'Invalid Browser Audit artifact upload grant request'
    );

    if (!body.ok) {
      return body.response;
    }

    const executionJob = getOwnedRunningExecutionJob(executionJobId, body.data.leaseOwner);
    if (!executionJob) {
      return executionLeaseConflict();
    }

    if (executionJob.kind !== 'browser_audit') {
      return json(
        { error: 'Artifact upload grants are only available for Browser Audit executions' },
        { status: 409, headers: { 'cache-control': 'no-store' } }
      );
    }

    return json(
      buildBrowserAuditArtifactUploadGrant(
        executionJob,
        body.data.leaseOwner,
        request
      ),
      { headers: { 'cache-control': 'no-store' } }
    );
  }

  if (action === 'result') {
    const body = await parseExecutionTransportBody(
      request,
      executionResourceResultRequestSchema,
      'Invalid execution result request'
    );

    if (!body.ok) {
      return body.response;
    }

    const executionJob = getOwnedRunningExecutionJob(executionJobId, body.data.leaseOwner);

    if (!executionJob) {
      return executionLeaseConflict();
    }

    if (executionJob.kind !== body.data.result.kind) {
      return json(
        { error: 'Execution result kind does not match the leased job' },
        { status: 409, headers: { 'cache-control': 'no-store' } }
      );
    }

    const persisted = persistExecutionResourceResult(
      executionJob,
      body.data.leaseOwner,
      body.data.result
    );

    if (!persisted) {
      return executionLeaseConflict();
    }

    return new Response(null, {
      status: 204,
      headers: { 'cache-control': 'no-store' }
    });
  }

  const body = await parseExecutionTransportBody(
    request,
    executionFollowupsRequestSchema,
    'Invalid execution follow-up request'
  );

  if (!body.ok) {
    return body.response;
  }

  const executionJob = getOwnedRunningExecutionJob(executionJobId, body.data.leaseOwner);

  if (!executionJob) {
    return executionLeaseConflict();
  }

  const parentPayload = executionJob.kind === 'network_probe'
    ? networkProbeExecutionPayloadSchema.parse(executionJob.payload)
    : null;

  if (
    !parentPayload?.runId
    || body.data.jobs.some((job) => {
      if (job.kind !== 'webhook_delivery' || job.resourceId !== parentPayload.runId) {
        return true;
      }

      const payload = webhookDeliveryExecutionPayloadSchema.safeParse(job.payload);
      return !payload.success || payload.data.runId !== parentPayload.runId;
    })
  ) {
    return json(
      { error: 'Only run-owned webhook follow-ups may be enqueued' },
      { status: 409, headers: { 'cache-control': 'no-store' } }
    );
  }

  const followups = repository.enqueueExecutionJobs({
    executionJobId: executionJob.id,
    leaseOwner: body.data.leaseOwner,
    jobs: body.data.jobs
  });

  if (!followups) {
    return executionLeaseConflict();
  }

  return json(
    executionFollowupsResponseSchema.parse({ jobs: followups }),
    { status: 201, headers: { 'cache-control': 'no-store' } }
  );
}

function getOwnedRunningExecutionJob(executionJobId: string, leaseOwner: string) {
  const executionJob = repository.getExecutionJob(executionJobId);
  const now = new Date().toISOString();

  if (
    !executionJob
    || executionJob.status !== 'running'
    || executionJob.leaseOwner !== leaseOwner
    || !executionJob.leaseExpiresAt
    || executionJob.leaseExpiresAt <= now
  ) {
    return null;
  }

  return executionJob;
}

function buildExecutionResourceContext(
  executionJob: NonNullable<ReturnType<typeof getOwnedRunningExecutionJob>>
): ExecutionResourceContext {
  if (executionJob.kind === 'network_probe') {
    const payload = networkProbeExecutionPayloadSchema.parse(executionJob.payload);
    const expectedResourceId =
      payload.runId ?? payload.regionalExecutionId ?? payload.jobIds[0];

    if (executionJob.resourceId !== expectedResourceId) {
      throw new Error('Network execution resource does not match its payload');
    }

    const jobs = payload.jobIds.map((jobId) => repository.getJob(jobId));

    if (jobs.some((job) => job === null)) {
      throw new Error('Network execution references a missing job');
    }

    const check = payload.checkId ? repository.getCheckProfile(payload.checkId) : null;
    const run = payload.runId ? repository.getCheckProfileRun(payload.runId) : null;

    if ((payload.checkId && !check) || (payload.runId && !run)) {
      throw new Error('Network execution references a missing check or run');
    }

    const baselineRun = check && run ? resolveBaselineRun(check) : null;
    let comparedRun: CheckProfileRun | null = null;
    let comparisonMode: 'baseline' | 'latest_previous' | null = null;

    if (check && run) {
      if (baselineRun && baselineRun.id !== run.id) {
        comparedRun = baselineRun;
        comparisonMode = 'baseline';
      } else {
        comparedRun = findPreviousRun(check.id, run.id);
        comparisonMode = comparedRun ? 'latest_previous' : null;
      }
    }

    return executionResourceContextSchema.parse({
      kind: 'network_probe',
      executionJob,
      payload,
      jobs,
      check,
      run,
      comparedRun,
      comparedJobs: comparedRun ? getJobsForRun(comparedRun) : [],
      comparisonMode
    });
  }

  if (executionJob.kind === 'browser_audit') {
    const payload = browserAuditExecutionPayloadSchema.parse(executionJob.payload);
    const audit = repository.getBrowserAudit(payload.auditId);

    if (executionJob.resourceId !== payload.auditId || !audit) {
      throw new Error('Browser audit execution references a missing resource');
    }

    return executionResourceContextSchema.parse({
      kind: 'browser_audit',
      executionJob,
      payload,
      audit
    });
  }

  const payload = webhookDeliveryExecutionPayloadSchema.parse(executionJob.payload);
  const run = repository.getCheckProfileRun(payload.runId);

  if (executionJob.resourceId !== payload.runId || !run) {
    throw new Error('Webhook execution references a missing run');
  }

  return executionResourceContextSchema.parse({
    kind: 'webhook_delivery',
    executionJob,
    payload,
    run
  });
}

function buildBrowserAuditArtifactUploadGrant(
  executionJob: NonNullable<ReturnType<typeof getOwnedRunningExecutionJob>>,
  leaseOwner: string,
  request: Request
) {
  const payload = browserAuditExecutionPayloadSchema.parse(executionJob.payload);
  if (
    executionJob.resourceId !== payload.auditId
    || !repository.getBrowserAudit(payload.auditId)
  ) {
    throw new Error('Browser Audit artifact grant references a missing resource');
  }

  const issuedAt = new Date();
  const expiresAt = new Date(
    issuedAt.getTime() + runtime.artifactUploadTtlSeconds * 1_000
  );
  const artifactUploadBaseUrl = resolveArtifactUploadBaseUrl(
    runtime.artifactUploadBaseUrl ?? new URL(request.url).origin
  );
  return browserAuditArtifactUploadGrantSchema.parse({
    baseUrl: artifactUploadBaseUrl,
    bearerToken: issueBrowserAuditUploadToken({
      secret: runtime.internalSecret,
      auditId: payload.auditId,
      executionJobId: executionJob.id,
      leaseOwner,
      attemptCount: executionJob.attemptCount,
      expiresAt,
      maxArtifactBytes: runtime.maxArtifactBytes,
      now: issuedAt
    }),
    expiresAt: expiresAt.toISOString(),
    maxArtifactBytes: runtime.maxArtifactBytes,
    allowedContentTypes: [...defaultBrowserAuditArtifactContentTypes]
  });
}

function persistExecutionResourceResult(
  executionJob: NonNullable<ReturnType<typeof getOwnedRunningExecutionJob>>,
  leaseOwner: string,
  result: ExecutionResourceResult
) {
  if (result.kind === 'network_probe') {
    const payload = networkProbeExecutionPayloadSchema.parse(executionJob.payload);
    const expectedJobIds = new Set(payload.jobIds);

    if (
      result.jobs.length !== expectedJobIds.size
      || result.jobs.some((job) => !expectedJobIds.has(job.id))
      || Boolean(result.run) !== Boolean(payload.runId)
      || (result.run && (result.run.id !== payload.runId || result.run.profileId !== payload.checkId))
    ) {
      throw new Error('Network execution result does not match its payload');
    }

    return repository.saveExecutionResourceResult({
      executionJobId: executionJob.id,
      leaseOwner,
      result
    });
  }

  if (result.kind === 'browser_audit') {
    const payload = browserAuditExecutionPayloadSchema.parse(executionJob.payload);
    const existing = repository.getBrowserAudit(payload.auditId);

    if (
      result.audit.id !== payload.auditId
      || !existing
      || !browserAuditInputsMatch(existing, result.audit)
      || !browserAuditArtifactsMatch(payload.auditId, result.audit.result?.artifacts ?? [])
    ) {
      throw new Error('Browser audit result does not match its payload');
    }

    return repository.saveExecutionResourceResult({
      executionJobId: executionJob.id,
      leaseOwner,
      result
    });
  }

  const payload = webhookDeliveryExecutionPayloadSchema.parse(executionJob.payload);

  if (
    result.runId !== payload.runId
    || result.delivery.targetId !== payload.target.id
    || result.delivery.targetName !== payload.target.name
    || result.delivery.url !== payload.target.url
  ) {
    throw new Error('Webhook result does not match its payload');
  }

  return repository.saveExecutionResourceResult({
    executionJobId: executionJob.id,
    leaseOwner,
    result
  });
}

const browserAuditInputsMatch = (
  existing: BrowserAuditResource,
  result: BrowserAuditResource
) =>
  existing.targetUrl === result.targetUrl
  && existing.region === result.region
  && existing.requestedAt === result.requestedAt
  && isDeepStrictEqual(existing.policy, result.policy)
  && isDeepStrictEqual(existing.customHeaders, result.customHeaders)
  && isDeepStrictEqual(existing.cookies, result.cookies);

const browserAuditArtifactsMatch = (
  auditId: string,
  artifacts: BrowserAuditArtifactRef[]
) => artifacts.every((artifact) => {
  const indexed = repository.getBrowserAuditArtifact(auditId, artifact.id);
  return Boolean(
    indexed
    && artifact.registryVersion === indexed.registryVersion
    && artifact.kind === indexed.kind
    && artifact.url === `/v1/browser-audits/${encodeURIComponent(auditId)}/artifacts/${encodeURIComponent(indexed.id)}`
    && artifact.filename !== undefined
    && artifact.filename !== null
    && artifact.filename === indexed.filename
    && artifact.contentType === indexed.contentType
    && artifact.byteSize !== undefined
    && artifact.byteSize !== null
    && artifact.byteSize === indexed.byteSize
    && artifact.sha256 !== undefined
    && artifact.sha256 !== null
    && artifact.sha256 === indexed.sha256
    && artifact.createdAt === indexed.createdAt
  );
});

const executionLeaseConflict = () =>
  json(
    { error: 'Execution lease is no longer owned or has expired' },
    { status: 409, headers: { 'cache-control': 'no-store' } }
  );

const isExecutionTransportPath = (pathname: string) =>
  pathname === '/internal/execution-jobs/claim'
  || executionJobMutationPathPattern.test(pathname)
  || executionJobResourcePathPattern.test(pathname);

// Follow-up transport can carry 20 bounded payloads plus identifiers and JSON framing.
const executionTransportBodyMaxBytes = executionPayloadMaxBytes * 20 + 64 * 1_024;

async function parseExecutionTransportBody<T>(
  request: Request,
  schema: {
    safeParse(value: unknown):
      | { success: true; data: T }
      | { success: false; error: { flatten(): unknown } };
  },
  errorLabel: string
) {
  const body = await parseJsonBody<unknown>(
    request,
    executionTransportBodyMaxBytes
  );

  if (!body.ok) {
    return {
      ok: false as const,
      response: withNoStore(body.response)
    };
  }

  const parsed = schema.safeParse(body.data);

  if (!parsed.success) {
    return {
      ok: false as const,
      response: json(
        { error: errorLabel, issues: parsed.error.flatten() },
        { status: 400, headers: { 'cache-control': 'no-store' } }
      )
    };
  }

  return { ok: true as const, data: parsed.data };
}

const withExecutionTransportErrors = async (
  operation: 'claim' | ExecutionJobMutationAction | ExecutionJobResourceAction,
  execute: () => Promise<Response>
) => {
  try {
    return await execute();
  } catch (error) {
    const incidentId = crypto.randomUUID();
    console.error(
      JSON.stringify({
        service: 'webperf-api',
        event: 'execution_transport_failed',
        operation,
        incidentId,
        ...describeSafeError(error)
      })
    );
    return json(
      { error: 'Execution transport failed', incidentId },
      { status: 500, headers: { 'cache-control': 'no-store' } }
    );
  }
};

const withNoStore = (response: Response) => {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};

async function handleCreateProperty(request: Request) {
  return handleUpsertProperty(request);
}

async function handleCreateRouteSet(request: Request) {
  return handleUpsertRouteSet(request);
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

  try {
    const now = new Date().toISOString();
    const name = requireTrimmedText(parsed.data.name, 'Check profile name');
    const note = normalizeOptionalText(parsed.data.note);
    const requestConfig = normalizeCustomRequestConfig(parsed.data.request, existing?.request);
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
      name,
      note,
      request: requestConfig,
      monitorPolicy,
      alerts,
      browserAuditPolicy: existing?.browserAuditPolicy ?? null,
      schedule: buildProfileSchedule(existing, parsed.data.scheduleIntervalMinutes, now),
      baseline: resolveUpdatedProfileBaseline(existing, routeSet.id),
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
  try {
    createNetworkExecutionResource(
      createdJobs.map((item) => item.job),
      run,
      profile.id
    );
  } catch (error) {
    const incidentId = logExecutionCreationFailure('manual_check_run', error, profile.id);
    return json(
      { error: 'Failed to queue check run', incidentId },
      { status: 500 }
    );
  }

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
    try {
      const createdJobs = createJobsForProfile(profile, null);
      const run = createCheckProfileRunRecord(profile, 'schedule', createdJobs);
      createNetworkExecutionResource(
        createdJobs.map((item) => item.job),
        run,
        profile.id
      );

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
    } catch (error) {
      logExecutionCreationFailure('scheduled_check_run', error, profile.id);
      return [];
    }
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

async function handleCreateBrowserAudit(request: Request) {
  const body = await parseJsonBody<CreateBrowserAuditInput>(request);

  if (!body.ok) {
    return body.response;
  }

  const parsed = createBrowserAuditInputSchema.safeParse(body.data);

  if (!parsed.success) {
    return json(
      {
        error: 'Invalid browser audit payload',
        issues: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  if (!runtime.browserAuditBaseUrl) {
    return json(
      {
        error: 'Browser audit direct-run is not configured'
      },
      { status: 503 }
    );
  }

  const requestedAt = new Date().toISOString();
  const executionId = `audit_${crypto.randomUUID()}`;
  const input = parsed.data;
  const browserAudit = browserAuditResourceSchema.parse({
    id: executionId,
    targetUrl: input.targetUrl,
    // Phase 1 of issue #14: Browser Audits run from the deployment's single
    // configured runtime location and record it as provenance automatically.
    region: runtime.runtimeLocation.regionId,
    status: 'queued',
    requestedAt,
    startedAt: null,
    completedAt: null,
    policy: input.policy,
    customHeaders: input.customHeaders,
    cookies: input.cookies,
    result: null,
    error: null
  });

  try {
    repository.createExecutionResource({
      executionJob: {
        id: `exec_${executionId}`,
        kind: 'browser_audit',
        resourceId: executionId,
        maxAttempts: runtime.maxTargetAttempts,
        payload: browserAuditExecutionPayloadSchema.parse({
          version: 'v1',
          auditId: executionId
        })
      },
      result: {
        kind: 'browser_audit',
        audit: browserAudit
      }
    });
  } catch (error) {
    const incidentId = logExecutionCreationFailure('browser_audit', error, executionId);
    return json(
      { error: 'Failed to queue Browser Audit', incidentId },
      { status: 500 }
    );
  }

  return json(browserAudit, { status: 202 });
}

function handleGetBrowserAudit(auditId: string) {
  const browserAudit = repository.getBrowserAudit(auditId);

  if (!browserAudit) {
    return json({ error: 'Browser audit not found' }, { status: 404 });
  }

  return json(browserAudit, { status: 200 });
}

async function handleBrowserAuditArtifactUpload(
  auditId: string,
  request: Request,
  url: URL
) {
  const token = readBearerToken(request.headers.get('authorization'));
  const claims = token
    ? verifyBrowserAuditUploadToken({
        token,
        secrets: [runtime.internalSecret, runtime.internalSecretNext]
      })
    : null;

  if (!claims || claims.auditId !== auditId) {
    return artifactUploadError('Artifact upload token is invalid or expired', 401);
  }

  const executionJob = repository.getExecutionJob(claims.executionJobId);
  const now = new Date().toISOString();
  if (
    !executionJob
    || executionJob.kind !== 'browser_audit'
    || executionJob.resourceId !== auditId
    || executionJob.status !== 'running'
    || executionJob.leaseOwner !== claims.leaseOwner
    || executionJob.attemptCount !== claims.attemptCount
    || !executionJob.leaseExpiresAt
    || executionJob.leaseExpiresAt <= now
    || !repository.getBrowserAudit(auditId)
  ) {
    return artifactUploadError('Artifact upload lease is no longer active', 409);
  }

  if (repository.listBrowserAuditArtifacts(auditId).length >= browserAuditArtifactLimit) {
    return artifactUploadError('Browser audit artifact limit has been reached', 409);
  }

  const kindValues = url.searchParams.getAll('kind');
  const filenameValues = url.searchParams.getAll('filename');
  const kind = browserAuditArtifactKindSchema.safeParse(kindValues[0]);
  if (kindValues.length !== 1 || !kind.success || filenameValues.length !== 1) {
    return artifactUploadError('Artifact kind and filename are required', 400);
  }

  let filename: string;
  try {
    filename = normalizeArtifactFilename(filenameValues[0] ?? '');
  } catch (error) {
    return artifactUploadError(
      error instanceof Error ? error.message : 'Artifact filename is invalid',
      400
    );
  }

  const contentType = request.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  const allowedContentTypes = browserAuditArtifactContentTypesForKind(kind.data);
  if (!contentType || !allowedContentTypes.includes(contentType)) {
    return artifactUploadError('Artifact content type is not allowed for its kind', 415);
  }

  const declaredSize = parseArtifactByteSize(request.headers.get('x-artifact-size'));
  if (declaredSize === null) {
    return artifactUploadError('Artifact byte size is required', 400);
  }

  const maxBytes = Math.min(runtime.maxArtifactBytes, claims.maxArtifactBytes);
  if (declaredSize > maxBytes) {
    return artifactUploadError('Artifact exceeds the configured byte limit', 413);
  }

  const contentLength = request.headers.get('content-length');
  if (contentLength !== null && parseArtifactByteSize(contentLength) !== declaredSize) {
    return artifactUploadError('Artifact content length does not match its declared size', 400);
  }

  const artifactId = `artifact_${crypto.randomUUID()}`;
  let storedStorageKey: string | null = null;
  let indexed = false;

  try {
    const stored = await artifactStore.write({
      auditId,
      artifactId,
      body: request.body,
      expectedBytes: declaredSize,
      maxBytes
    });
    storedStorageKey = stored.storageKey;
    const createdAt = new Date().toISOString();
    indexed = repository.saveBrowserAuditArtifact({
      id: artifactId,
      auditId,
      registryVersion: browserAuditArtifactRegistryVersion,
      kind: kind.data,
      filename,
      contentType,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      storageKey: stored.storageKey,
      createdAt
    });

    if (!indexed) {
      return artifactUploadError('Artifact could not be indexed', 409);
    }

    const artifact = browserAuditArtifactRefSchema.parse({
      id: artifactId,
      registryVersion: browserAuditArtifactRegistryVersion,
      kind: kind.data,
      url: `/v1/browser-audits/${encodeURIComponent(auditId)}/artifacts/${encodeURIComponent(artifactId)}`,
      filename,
      contentType,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      createdAt
    });
    return json(artifact, {
      status: 201,
      headers: { 'cache-control': 'no-store' }
    });
  } catch (error) {
    if (error instanceof ArtifactStoreValidationError) {
      return artifactUploadError(error.message, error.status);
    }

    const incidentId = crypto.randomUUID();
    console.error(JSON.stringify({
      service: 'webperf-api',
      event: 'browser_audit_artifact_upload_failed',
      auditId,
      incidentId,
      ...describeSafeError(error)
    }));
    return artifactUploadError('Artifact upload failed', 500, incidentId);
  } finally {
    if (storedStorageKey && !indexed) {
      await artifactStore.delete(storedStorageKey).catch((error) => {
        console.warn(JSON.stringify({
          service: 'webperf-api',
          warning: 'browser_audit_artifact_cleanup_failed',
          storageKey: storedStorageKey,
          ...describeSafeError(error)
        }));
      });
    }
  }
}

async function handleBrowserAuditArtifactDownload(
  auditId: string,
  artifactId: string
) {
  const artifact = repository.getBrowserAuditArtifact(auditId, artifactId);
  if (!artifact || !repository.getBrowserAudit(auditId)) {
    return json({ error: 'Browser audit artifact not found' }, { status: 404 });
  }

  try {
    const download = await artifactStore.openDownload(
      artifact.storageKey,
      artifact.byteSize
    );
    return new Response(download.body, {
      status: 200,
      headers: {
        'cache-control': 'private, no-store',
        'content-type': artifact.contentType,
        'content-disposition': `attachment; filename="${artifact.filename}"`,
        'x-content-type-options': 'nosniff',
        'x-webperf-artifact-bytes': String(download.byteSize),
        etag: `"sha256-${artifact.sha256}"`
      }
    });
  } catch (error) {
    console.warn(JSON.stringify({
      service: 'webperf-api',
      warning: 'browser_audit_artifact_file_unavailable',
      auditId,
      artifactId,
      ...describeSafeError(error)
    }));
    return json({ error: 'Browser audit artifact not found' }, { status: 404 });
  }
}

const parseArtifactByteSize = (value: string | null) => {
  if (!value || !/^(0|[1-9][0-9]*)$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const readBearerToken = (authorization: string | null) =>
  authorization?.match(/^Bearer\s+([^\s]+)$/i)?.[1] ?? null;

const artifactUploadError = (
  error: string,
  status: number,
  incidentId?: string
) => json(
  incidentId ? { error, incidentId } : { error },
  { status, headers: { 'cache-control': 'no-store' } }
);

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

function createJobRecord({
  url,
  note,
  requestConfig,
  monitorPolicy,
  requesterIp,
  id,
  maxAttempts,
  requestSource = 'operator'
}: {
  url: string;
  note: string | null;
  requestConfig?: CreateLatencyJobInput['request'];
  monitorPolicy?: CreateLatencyJobInput['monitorPolicy'];
  requesterIp: string | null;
  id?: string;
  maxAttempts?: number;
  requestSource?: 'operator' | 'regional-runtime';
}) {
  validateMeasurementUrl(url);

  // Phase 1 of issue #14: one standalone deployment measures from one fixed
  // runtime location. The resolved region id is stamped onto the job and
  // every target as provenance.
  const region: RuntimeRegionId = runtime.runtimeLocation.regionId;
  const now = new Date().toISOString();
  const jobId = id ?? `job_${crypto.randomUUID()}`;
  const target: MutableTarget = {
    jobId,
    region,
    status: 'queued',
    attemptNo: 0,
    maxAttempts: maxAttempts ?? runtime.maxTargetAttempts,
    latencyMs: null,
    statusCode: null,
    success: null,
    probeImpl: null,
    measurement: null,
    execution: {
      runnerType: 'network_probe',
      provider: 'selfhost',
      locationMode: 'fixed',
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
  };

  const targets = [target];

  const job: MutableJob = {
    id: jobId,
    url,
    status: 'queued',
    note,
    request: requestSource === 'regional-runtime'
      ? normalizeRegionalRequestConfig(requestConfig)
      : normalizeCustomRequestConfig(requestConfig),
    monitorPolicy: normalizeMonitorPolicy(monitorPolicy),
    requestedAt: now,
    startedAt: null,
    completedAt: null,
    requesterIp,
    region,
    targets,
    evaluation: null,
    summary: summarizeTargets(targets)
  };

  return job;
}

function createNetworkExecutionResource(
  jobs: LatencyJobDetail[],
  run: CheckProfileRun | null,
  checkId: string | null
) {
  const resource = buildNetworkExecutionResourceInput(jobs, run, checkId);
  repository.pruneJobsOlderThan(runtime.retentionDays);
  return repository.createExecutionResource(resource);
}

function buildNetworkExecutionResourceInput(
  jobs: LatencyJobDetail[],
  run: CheckProfileRun | null,
  checkId: string | null,
  options: {
    resourceId?: string;
    executionJobId?: string;
    deadlineAt?: string | null;
    regionalExecutionId?: string | null;
  } = {}
) {
  const firstJob = jobs[0];

  if (!firstJob) {
    throw new Error('Network execution requires at least one job');
  }

  const resourceId = options.resourceId ?? run?.id ?? firstJob.id;
  const attemptCounts = jobs.flatMap((job) =>
    job.targets.map((target) => target.maxAttempts)
  );

  if (attemptCounts.length === 0) {
    throw new Error('Network execution requires at least one target');
  }

  const maxAttempts = Math.max(...attemptCounts);
  const payload = networkProbeExecutionPayloadSchema.parse({
    version: 'v1',
    jobIds: jobs.map((job) => job.id),
    checkId,
    runId: run?.id ?? null,
    regionalExecutionId: options.regionalExecutionId ?? null,
    deadlineAt: options.deadlineAt ?? null
  });

  return {
    executionJob: {
      id: options.executionJobId ?? `exec_${resourceId}`,
      kind: 'network_probe' as const,
      resourceId,
      maxAttempts,
      payload
    },
    result: {
      kind: 'network_probe' as const,
      jobs,
      run
    }
  };
}

function logExecutionCreationFailure(
  operation: 'manual_job_create' | 'manual_check_run' | 'scheduled_check_run' | 'browser_audit',
  error: unknown,
  resourceId: string
) {
  const incidentId = crypto.randomUUID();
  console.error(JSON.stringify({
    service: 'webperf-api',
    event: 'execution_creation_failed',
    operation,
    resourceId,
    incidentId,
    ...describeSafeError(error)
  }));
  return incidentId;
}

function createJobsForProfile(profile: CheckProfile, requesterIp: string | null): CreatedProfileJob[] {
  const routeSet = repository.getRouteSet(profile.routeSetId);
  if (!routeSet) {
    throw new Error('Route set not found for profile');
  }

  return routeSet.routes.map((route) =>
    ({
      routeId: route.id,
      routeLabel: route.label,
      url: route.url,
      job: createJobRecord({
        url: route.url,
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
    browserAuditSummary: null,
    evaluation: null,
    alertDeliveries: [],
    routes: createdJobs.map((item) => ({
      routeId: item.routeId,
      routeLabel: item.routeLabel,
      url: item.url,
      jobId: item.job.id,
      browserAudit: null
    }))
  };

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

function normalizeCustomRequestConfig(
  request: CreateLatencyJobInput['request'] | CreateCheckProfileInput['request'],
  existing?: CheckProfile['request']
) {
  return {
    method: request?.method ?? 'GET',
    headers: (request?.headers ?? []).map((header) => ({
      name: requireTrimmedText(header.name, 'Header name'),
      value: resolveMaskedHeaderValue(header.name, header.value.trim(), existing)
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

function resolveMaskedHeaderValue(
  name: string,
  value: string,
  existing: CheckProfile['request'] | undefined
) {
  if (value !== redactedValue || !isSensitiveHeaderName(name)) {
    return value;
  }

  const previous = existing?.headers.find(
    (header) => header.name.trim().toLowerCase() === name.trim().toLowerCase()
  );

  if (!previous) {
    throw new Error(`A new sensitive header cannot use ${redactedValue} as its value`);
  }

  return previous.value;
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
      secret: resolveMaskedWebhookSecret(target.secret, previousTarget?.secret ?? null)
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

function resolveMaskedWebhookSecret(
  value: string | null | undefined,
  previousValue: string | null
) {
  if (value !== redactedValue) {
    return normalizeOptionalText(value);
  }

  if (!previousValue) {
    throw new Error(`A new webhook secret cannot use ${redactedValue} as its value`);
  }

  return previousValue;
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
  nextRouteSetId: string
) {
  if (!existing?.baseline) {
    return null;
  }

  if (existing.routeSetId !== nextRouteSetId) {
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
    artifactsPath: parsed.SELFHOST_ARTIFACTS_PATH,
    artifactUploadBaseUrl: parsed.SELFHOST_ARTIFACT_UPLOAD_BASE_URL
      ? resolveArtifactUploadBaseUrl(parsed.SELFHOST_ARTIFACT_UPLOAD_BASE_URL)
      : undefined,
    maxArtifactBytes: parsed.SELFHOST_MAX_ARTIFACT_BYTES,
    artifactUploadTtlSeconds: parsed.SELFHOST_ARTIFACT_UPLOAD_TTL_SECONDS,
    retentionDays: parsed.SELFHOST_RETENTION_DAYS,
    migrationBackup: parsed.SELFHOST_MIGRATION_BACKUP,
    adminToken: parsed.SELFHOST_ADMIN_TOKEN,
    adminTokenNext: parsed.SELFHOST_ADMIN_TOKEN_NEXT,
    internalSecret: parsed.SELFHOST_INTERNAL_SECRET,
    internalSecretNext: parsed.SELFHOST_INTERNAL_SECRET_NEXT,
    browserAuditBaseUrl: parsed.SELFHOST_BROWSER_AUDIT_BASE_URL,
    runtimeLocation: resolveRuntimeLocation({
      regionId: parsed.SELFHOST_REGION_ID,
      label: parsed.SELFHOST_REGION_LABEL
    }),
    probeBaseUrl: parsed.SELFHOST_PROBE_BASE_URL,
    maxTargetAttempts: parsed.SELFHOST_MAX_TARGET_ATTEMPTS,
    schedulerMode: parsed.SELFHOST_SCHEDULER_MODE,
    schedulerPollIntervalSeconds: parsed.SELFHOST_SCHEDULER_POLL_INTERVAL_SECONDS,
    runtimeMode: parsed.SELFHOST_RUNTIME_MODE,
    regionalRuntimeSecret: parsed.REGIONAL_RUNTIME_SHARED_SECRET,
    regionalRuntimeSecretNext: parsed.REGIONAL_RUNTIME_SHARED_SECRET_NEXT,
    runtimeVersion: parsed.WEBPERF_RUNTIME_VERSION,
    runtimeImageDigest: parsed.WEBPERF_RUNTIME_IMAGE_DIGEST,
    probeImageDigest: parsed.WEBPERF_PROBE_IMAGE_DIGEST
  };
}

function resolveArtifactUploadBaseUrl(value: string) {
  const url = new URL(value);

  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
  ) {
    throw new Error('Artifact upload base URL must be a credential-free HTTP(S) origin');
  }

  return url.origin;
}

function getRuntimeLocationReport(): RuntimeLocationReport {
  return runtimeLocationReportSchema.parse({
    regionId: runtime.runtimeLocation.regionId,
    label: runtime.runtimeLocation.label
  });
}

async function parseJsonBody<T>(request: Request, maxBytes = 1_024 * 1_024) {
  try {
    return {
      ok: true as const,
      data: (await readBoundedJson(request, maxBytes)) as T
    };
  } catch (error) {
    let message = 'Invalid JSON payload';
    let status = 400;

    if (error instanceof JsonBodyTooLargeError) {
      message = error.message;
      status = 413;
    } else if (error instanceof JsonBodyEmptyError) {
      message = error.message;
    }

    return {
      ok: false as const,
      response: json(
        { error: message },
        { status }
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

const compatibilityRouteMappings = [
  { legacy: '/v1/properties', canonical: '/v1/sites' },
  { legacy: '/v1/route-sets', canonical: '/v1/route-groups' },
  // Phase 1 of issue #14: /v1/region-packs and /v1/region-sets were both
  // removed and now return 410 Gone. No successor deprecation header is
  // attached because there is no canonical region-set surface to migrate to.
  { legacy: '/v1/check-profiles', canonical: '/v1/checks' }
] as const;

function addCompatibilityDeprecationHeaders(request: Request, response: Response) {
  const requestUrl = new URL(request.url);
  const mapping = compatibilityRouteMappings.find(
    ({ legacy }) => requestUrl.pathname === legacy || requestUrl.pathname.startsWith(`${legacy}/`)
  );

  if (!mapping) {
    return response;
  }

  const successorUrl = new URL(
    `${mapping.canonical}${requestUrl.pathname.slice(mapping.legacy.length)}`,
    requestUrl.origin
  );
  successorUrl.search = requestUrl.search;

  const headers = new Headers(response.headers);
  headers.set('deprecation', 'true');
  // A Sunset date will be added only after the public v1.0 removal date is announced.
  headers.append('link', `<${successorUrl.toString()}>; rel="successor-version"`);
  headers.set(
    'warning',
    `299 WebPerf "Deprecated API path; migrate to ${successorUrl.pathname}"`
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
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
    runtimeLocation: getRuntimeLocationReport()
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
      runtimeLocation: getRuntimeLocationReport()
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
  },
  browserAudits: {
    list: publicApi.browserAudits.list.handler(async ({ input }) =>
      buildBrowserAuditListResponse(input.query)
    ),
    create: publicApi.browserAudits.create.handler(async ({ input }) =>
      unwrapJsonResponse(await handleCreateBrowserAudit(createInternalRequest('/v1/browser-audits', {
        method: 'POST',
        body: input
      })))
    ),
    get: publicApi.browserAudits.get.handler(async ({ input }) => {
      const browserAudit = repository.getBrowserAudit(input.params.auditId);

      if (!browserAudit) {
        throw new ORPCError('NOT_FOUND', { message: 'Browser audit not found' });
      }

      return browserAudit;
    })
  }
});

const appRouter = appApi.router({
  system: {
    health: appApi.system.health.handler(async () => buildHealthPayload()),
    regions: appApi.system.regions.handler(async () => ({
      runtimeLocation: getRuntimeLocationReport()
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
  browserAudits: {
    list: appApi.browserAudits.list.handler(async ({ input }): Promise<BrowserAuditListResponse> =>
      buildBrowserAuditListResponse(input.query)
    ),
    create: appApi.browserAudits.create.handler(async ({ input }): Promise<BrowserAuditResource> =>
      unwrapJsonResponse(
        await handleCreateBrowserAudit(
          createInternalRequest('/v1/browser-audits', {
            method: 'POST',
            body: input
          })
        )
      )
    ),
    get: appApi.browserAudits.get.handler(async ({ input }): Promise<BrowserAuditResource> =>
      unwrapJsonResponse(handleGetBrowserAudit(input.params.auditId))
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
      runtimeLocation: getRuntimeLocationReport()
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
let regionalRuntimeOpenApiDocumentPromise: Promise<unknown> | undefined;

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

const getRegionalRuntimeOpenApiDocument = async () => {
  if (!regionalRuntimeOpenApiDocumentPromise) {
    regionalRuntimeOpenApiDocumentPromise = Promise.resolve(
      buildRegionalRuntimeOpenApiDocument({
        title: 'WebPerf Regional Runtime API',
        version: `v${regionalRuntimeProtocolVersion}`,
        description:
          'Signed, idempotent network-probe handoff from a managed Cloud control plane to one fixed regional runtime.',
        serverUrl: '/'
      })
    );
  }

  return await regionalRuntimeOpenApiDocumentPromise;
};

export type SelfhostControlServer = typeof server;

let shutdownPromise: Promise<void> | undefined;

export const shutdown = (signal = 'manual') => {
  if (!shutdownPromise) {
    shutdownPromise = (async () => {
      console.log(JSON.stringify({ service: 'webperf-api', event: 'shutdown.started', signal }));
      embeddedSchedulerAbort?.abort(new Error(`Embedded scheduler shutdown on ${signal}`));
      let forceStopTimer: ReturnType<typeof setTimeout> | undefined;
      const forceStop = new Promise<void>((resolve, reject) => {
        forceStopTimer = setTimeout(() => {
          console.warn(JSON.stringify({
            service: 'webperf-api',
            event: 'shutdown.force_stop',
            signal
          }));
          void server.stop(true).then(resolve, reject);
        }, 10_000);
      });

      try {
        await Promise.race([server.stop(false), forceStop]);
      } finally {
        clearTimeout(forceStopTimer);
        removeShutdownSignalHandlers();
        repository.close();
      }

      console.log(JSON.stringify({ service: 'webperf-api', event: 'shutdown.completed', signal }));
    })();
  }

  return shutdownPromise;
};

const handleShutdownSignal = (signal: 'SIGINT' | 'SIGTERM') => {
  void shutdown(signal).catch((error) => {
    console.error(JSON.stringify({
      service: 'webperf-api',
      event: 'shutdown.failed',
      signal,
      error: describeSafeError(error)
    }));
    process.exitCode = 1;
  });
};

const onSigint = () => handleShutdownSignal('SIGINT');
const onSigterm = () => handleShutdownSignal('SIGTERM');
process.once('SIGINT', onSigint);
process.once('SIGTERM', onSigterm);

function removeShutdownSignalHandlers() {
  process.off('SIGINT', onSigint);
  process.off('SIGTERM', onSigterm);
}
