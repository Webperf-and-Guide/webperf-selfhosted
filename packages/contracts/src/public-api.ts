import { z } from 'zod';
import {
  browserAuditExecutionSummarySchema,
  browserAuditPolicySchema,
  browserAuditRunSummarySchema
} from './browser-audit';
import { probeImplementationSchema, probeMeasurementSchema } from './probe-model';
import { regionCodes, regionCodeSchema } from './regions';

export { regionCodes, regionCodeSchema } from './regions';
export type { RegionCode } from './regions';

export const targetStatusValues = [
  'queued',
  'slot_allocating',
  'deploying',
  'healthy',
  'measuring',
  'succeeded',
  'failed'
] as const;
export const targetStatusSchema = z.enum(targetStatusValues);
export type TargetStatus = z.infer<typeof targetStatusSchema>;

export const errorClassValues = ['retryable', 'terminal'] as const;
export const errorClassSchema = z.enum(errorClassValues);
export type ErrorClass = z.infer<typeof errorClassSchema>;

export const jobStatusValues = [...targetStatusValues, 'partial'] as const;
export const jobStatusSchema = z.enum(jobStatusValues);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const regionLaunchStageValues = ['core', 'catalog'] as const;
export const regionLaunchStageSchema = z.enum(regionLaunchStageValues);
export type RegionLaunchStage = z.infer<typeof regionLaunchStageSchema>;

export const requestMethodValues = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
export const requestMethodSchema = z.enum(requestMethodValues);
export type RequestMethod = z.infer<typeof requestMethodSchema>;

export const requestBodyModeValues = ['text'] as const;
export const requestBodyModeSchema = z.enum(requestBodyModeValues);
export type RequestBodyMode = z.infer<typeof requestBodyModeSchema>;

export const requestHeaderSchema = z.object({
  name: z.string().min(1).max(120),
  value: z.string().max(4_000)
});
export type RequestHeader = z.infer<typeof requestHeaderSchema>;

export const requestBodySchema = z.object({
  mode: requestBodyModeSchema.default('text'),
  contentType: z.string().min(1).max(120).nullable().default(null),
  value: z.string().max(10_000)
});
export type RequestBody = z.infer<typeof requestBodySchema>;

export const customRequestConfigSchema = z
  .object({
    method: requestMethodSchema.default('GET'),
    headers: z.array(requestHeaderSchema).max(20).default([]),
    body: requestBodySchema.nullable().default(null)
  })
  .superRefine((value, context) => {
    if ((value.method === 'GET' || value.method === 'HEAD') && value.body != null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.method} requests cannot include a request body`,
        path: ['body']
      });
    }
  });
export type CustomRequestConfig = z.infer<typeof customRequestConfigSchema>;

export const monitorTypeValues = ['latency', 'uptime'] as const;
export const monitorTypeSchema = z.enum(monitorTypeValues);
export type MonitorType = z.infer<typeof monitorTypeSchema>;

export const successRuleValues = ['status_2xx_3xx'] as const;
export const successRuleSchema = z.enum(successRuleValues);
export type SuccessRule = z.infer<typeof successRuleSchema>;

export const monitorStatusValues = ['healthy', 'warning', 'failed'] as const;
export const monitorStatusSchema = z.enum(monitorStatusValues);
export type MonitorStatus = z.infer<typeof monitorStatusSchema>;

export const monitorPolicySchema = z.object({
  monitorType: monitorTypeSchema.default('latency'),
  successRule: successRuleSchema.default('status_2xx_3xx'),
  latencyThresholdMs: z.number().int().positive().nullable().default(null)
});
export type MonitorPolicy = z.infer<typeof monitorPolicySchema>;

export const alertTriggerSchema = z.object({
  onFailure: z.boolean().default(true),
  onLatencyThresholdBreach: z.boolean().default(false),
  onRegression: z.boolean().default(false)
});
export type AlertTrigger = z.infer<typeof alertTriggerSchema>;

export const webhookAlertTargetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  url: z.string().url(),
  enabled: z.boolean().default(true),
  secret: z.string().max(200).nullable().default(null)
});
export type WebhookAlertTarget = z.infer<typeof webhookAlertTargetSchema>;

export const createWebhookAlertTargetSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().url(),
  enabled: z.boolean().optional(),
  secret: z.string().max(200).optional()
});
export type CreateWebhookAlertTargetInput = z.infer<typeof createWebhookAlertTargetSchema>;

export const checkProfileAlertConfigSchema = z.object({
  enabled: z.boolean().default(false),
  webhookTargets: z.array(webhookAlertTargetSchema).max(5).default([]),
  triggers: alertTriggerSchema.default({
    onFailure: true,
    onLatencyThresholdBreach: false,
    onRegression: false
  })
});
export type CheckProfileAlertConfig = z.infer<typeof checkProfileAlertConfigSchema>;

export const createCheckProfileAlertConfigSchema = z.object({
  enabled: z.boolean().optional(),
  webhookTargets: z.array(createWebhookAlertTargetSchema).max(5).optional(),
  triggers: alertTriggerSchema.partial().optional()
});
export type CreateCheckProfileAlertConfigInput = z.infer<typeof createCheckProfileAlertConfigSchema>;

export const executionRunnerTypeSchema = z.enum(['network_probe', 'browser_audit']);
export type ExecutionRunnerType = z.infer<typeof executionRunnerTypeSchema>;

export const executionProviderSchema = z.enum(['selfhost', 'cloudflare', 'bunny']);
export type ExecutionProvider = z.infer<typeof executionProviderSchema>;

export const locationModeSchema = z.enum(['best_effort', 'fixed']);
export type LocationMode = z.infer<typeof locationModeSchema>;

export const executionMetaSchema = z.object({
  runnerType: executionRunnerTypeSchema,
  provider: executionProviderSchema,
  locationMode: locationModeSchema,
  region: regionCodeSchema.nullable().default(null),
  city: z.string().min(1).nullable().default(null),
  runnerVersion: z.string().min(1).nullable().default(null)
});
export type ExecutionMeta = z.infer<typeof executionMetaSchema>;

export const monitorEvaluationSchema = z.object({
  monitorType: monitorTypeSchema,
  successRule: successRuleSchema,
  status: monitorStatusSchema,
  totalChecks: z.number().int().nonnegative(),
  healthyChecks: z.number().int().nonnegative(),
  failedChecks: z.number().int().nonnegative(),
  latencyThresholdMs: z.number().int().positive().nullable(),
  thresholdBreached: z.boolean(),
  thresholdBreachedCount: z.number().int().nonnegative(),
  worstLatencyMs: z.number().int().nonnegative().nullable(),
  regressionDetected: z.boolean(),
  regressedCount: z.number().int().nonnegative()
});
export type MonitorEvaluation = z.infer<typeof monitorEvaluationSchema>;

export const checkProfileAlertDeliverySchema = z.object({
  targetId: z.string().min(1),
  targetName: z.string().min(1).max(120),
  url: z.string().url(),
  deliveredAt: z.string().datetime(),
  status: z.enum(['sent', 'failed']),
  responseStatus: z.number().int().min(100).max(599).nullable(),
  error: z.string().min(1).nullable()
});
export type CheckProfileAlertDelivery = z.infer<typeof checkProfileAlertDeliverySchema>;

export const publicApiPaths = [
  '/health',
  '/v1/health',
  '/v1/regions',
  '/v1/jobs',
  '/v1/jobs/:id',
  '/v1/jobs/:id/stream',
  '/v1/properties',
  '/v1/properties/:id',
  '/v1/route-sets',
  '/v1/route-sets/:id',
  '/v1/region-packs',
  '/v1/region-packs/:id',
  '/v1/check-profiles',
  '/v1/check-profiles/:id',
  '/v1/check-profiles/:id/baseline',
  '/v1/check-profiles/:id/runs',
  '/v1/check-profiles/:id/runs/:runId',
  '/v1/check-profiles/:id/runs/:runId/compare',
  '/v1/check-profiles/:id/compare/latest',
  '/v1/check-profiles/:id/compare/baseline',
  '/v1/check-profiles/:id/report',
  '/v1/check-profiles/:id/report/export',
  '/v1/scheduler/dispatch'
] as const;

export const createLatencyJobSchema = z.object({
  url: z.string().url(),
  regions: z.array(regionCodeSchema).min(1).max(4).optional(),
  note: z.string().max(200).optional(),
  request: customRequestConfigSchema.optional(),
  monitorPolicy: monitorPolicySchema.optional(),
  turnstileToken: z.string().min(1).optional()
});
export type CreateLatencyJobInput = z.infer<typeof createLatencyJobSchema>;

export const propertySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type Property = z.infer<typeof propertySchema>;

export const createPropertySchema = z.object({
  name: z.string().min(1).max(120),
  baseUrl: z.string().url()
});
export type CreatePropertyInput = z.infer<typeof createPropertySchema>;

export const updatePropertySchema = createPropertySchema;
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;

export const routeSetRouteSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(120),
  url: z.string().url()
});
export type RouteSetRoute = z.infer<typeof routeSetRouteSchema>;

export const createRouteSetRouteSchema = z.object({
  label: z.string().min(1).max(120),
  url: z.string().url()
});
export type CreateRouteSetRouteInput = z.infer<typeof createRouteSetRouteSchema>;

export const routeSetSchema = z.object({
  id: z.string().min(1),
  propertyId: z.string().min(1),
  name: z.string().min(1).max(120),
  routes: z.array(routeSetRouteSchema).min(1).max(20),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type RouteSet = z.infer<typeof routeSetSchema>;

export const createRouteSetSchema = z.object({
  propertyId: z.string().min(1),
  name: z.string().min(1).max(120),
  routes: z.array(createRouteSetRouteSchema).min(1).max(20)
});
export type CreateRouteSetInput = z.infer<typeof createRouteSetSchema>;

export const updateRouteSetSchema = createRouteSetSchema;
export type UpdateRouteSetInput = z.infer<typeof updateRouteSetSchema>;

export const regionPackSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  regions: z.array(regionCodeSchema).min(1).max(4),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type RegionPack = z.infer<typeof regionPackSchema>;

export const createRegionPackSchema = z.object({
  name: z.string().min(1).max(120),
  regions: z.array(regionCodeSchema).min(1).max(4)
});
export type CreateRegionPackInput = z.infer<typeof createRegionPackSchema>;

export const updateRegionPackSchema = createRegionPackSchema;
export type UpdateRegionPackInput = z.infer<typeof updateRegionPackSchema>;

export const checkProfileScheduleSchema = z.object({
  intervalMinutes: z.number().int().min(5),
  nextRunAt: z.string().datetime().nullable(),
  lastRunAt: z.string().datetime().nullable(),
  lastRunJobCount: z.number().int().nonnegative().nullable()
});
export type CheckProfileSchedule = z.infer<typeof checkProfileScheduleSchema>;

export const checkProfileBaselineSchema = z.object({
  runId: z.string().min(1),
  pinnedAt: z.string().datetime()
});
export type CheckProfileBaseline = z.infer<typeof checkProfileBaselineSchema>;

export const checkProfileRunTriggerSchema = z.enum(['manual', 'schedule']);
export type CheckProfileRunTrigger = z.infer<typeof checkProfileRunTriggerSchema>;

export const checkProfileSchema = z.object({
  id: z.string().min(1),
  propertyId: z.string().min(1),
  routeSetId: z.string().min(1),
  regionPackId: z.string().min(1),
  name: z.string().min(1).max(120),
  note: z.string().max(200).nullable(),
  request: customRequestConfigSchema.optional(),
  monitorPolicy: monitorPolicySchema.optional(),
  alerts: checkProfileAlertConfigSchema.optional(),
  browserAuditPolicy: browserAuditPolicySchema.nullable().default(null),
  schedule: checkProfileScheduleSchema.nullable(),
  baseline: checkProfileBaselineSchema.nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type CheckProfile = z.infer<typeof checkProfileSchema>;

export const createCheckProfileSchema = z.object({
  propertyId: z.string().min(1),
  routeSetId: z.string().min(1),
  regionPackId: z.string().min(1),
  name: z.string().min(1).max(120),
  note: z.string().max(200).optional(),
  request: customRequestConfigSchema.optional(),
  monitorPolicy: monitorPolicySchema.optional(),
  alerts: createCheckProfileAlertConfigSchema.optional(),
  browserAuditPolicy: browserAuditPolicySchema.optional(),
  scheduleIntervalMinutes: z.number().int().min(5).optional()
});
export type CreateCheckProfileInput = z.infer<typeof createCheckProfileSchema>;

export const updateCheckProfileSchema = createCheckProfileSchema;
export type UpdateCheckProfileInput = z.infer<typeof updateCheckProfileSchema>;

export const setCheckProfileBaselineSchema = z.object({
  runId: z.string().min(1)
});
export type SetCheckProfileBaselineInput = z.infer<typeof setCheckProfileBaselineSchema>;

export const listQuerySchema = z.object({
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  pageToken: z.string().regex(/^\d+$/).optional(),
  filter: z.string().trim().min(1).max(120).optional()
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const pageInfoSchema = z.object({
  pageSize: z.number().int().min(1),
  totalCount: z.number().int().nonnegative(),
  nextPageToken: z.string().nullable(),
  filter: z.string().nullable()
});
export type PageInfo = z.infer<typeof pageInfoSchema>;

export const checkProfileRunRouteSchema = z.object({
  routeId: z.string().min(1),
  routeLabel: z.string().min(1).max(120),
  url: z.string().url(),
  jobId: z.string().min(1),
  browserAudit: browserAuditExecutionSummarySchema.nullable().default(null)
});
export type CheckProfileRunRoute = z.infer<typeof checkProfileRunRouteSchema>;

export const checkProfileRunSchema = z.object({
  id: z.string().min(1),
  profileId: z.string().min(1),
  trigger: checkProfileRunTriggerSchema,
  createdAt: z.string().datetime(),
  routeCount: z.number().int().positive(),
  routes: z.array(checkProfileRunRouteSchema).min(1),
  browserAuditSummary: browserAuditRunSummarySchema.nullable().default(null),
  evaluation: monitorEvaluationSchema.nullable().default(null),
  alertDeliveries: z.array(checkProfileAlertDeliverySchema).default([])
});
export type CheckProfileRun = z.infer<typeof checkProfileRunSchema>;

export const propertyListResponseSchema = z.object({
  properties: z.array(propertySchema),
  pageInfo: pageInfoSchema
});
export type PropertyListResponse = z.infer<typeof propertyListResponseSchema>;

export const routeSetListResponseSchema = z.object({
  routeSets: z.array(routeSetSchema),
  pageInfo: pageInfoSchema
});
export type RouteSetListResponse = z.infer<typeof routeSetListResponseSchema>;

export const regionPackListResponseSchema = z.object({
  regionPacks: z.array(regionPackSchema),
  pageInfo: pageInfoSchema
});
export type RegionPackListResponse = z.infer<typeof regionPackListResponseSchema>;

export const checkProfileListResponseSchema = z.object({
  checkProfiles: z.array(checkProfileSchema),
  pageInfo: pageInfoSchema
});
export type CheckProfileListResponse = z.infer<typeof checkProfileListResponseSchema>;

export const checkProfileRunListResponseSchema = z.object({
  runs: z.array(checkProfileRunSchema),
  pageInfo: pageInfoSchema
});
export type CheckProfileRunListResponse = z.infer<typeof checkProfileRunListResponseSchema>;

export const regionAvailabilitySchema = z.object({
  code: regionCodeSchema,
  label: z.string().min(1),
  city: z.string().min(1),
  continent: z.string().min(1),
  selectable: z.boolean(),
  defaultSelected: z.boolean(),
  launchStage: regionLaunchStageSchema,
  rolloutTrack: z.enum(['core', 'catalog']),
  bunnyRegionHint: z.string().min(1).optional()
});
export type RegionAvailability = z.infer<typeof regionAvailabilitySchema>;

export const latencyJobTargetSchema = z.object({
  jobId: z.string().min(1),
  region: regionCodeSchema,
  status: targetStatusSchema,
  attemptNo: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  latencyMs: z.number().int().nonnegative().nullable(),
  statusCode: z.number().int().min(100).max(599).nullable(),
  success: z.boolean().nullable(),
  probeImpl: probeImplementationSchema.nullable(),
  measurement: probeMeasurementSchema.nullable(),
  execution: executionMetaSchema.nullable().optional(),
  slotId: z.string().min(1).nullable(),
  errorCode: z.string().min(1).nullable(),
  errorClass: errorClassSchema.nullable(),
  errorMessage: z.string().min(1).nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime()
});
export type LatencyJobTarget = z.infer<typeof latencyJobTargetSchema>;

export const latencyJobSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  status: jobStatusSchema,
  note: z.string().max(200).nullable(),
  request: customRequestConfigSchema.optional(),
  monitorPolicy: monitorPolicySchema.optional(),
  requestedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  requesterIp: z.string().min(1).nullable(),
  selectedRegions: z.array(regionCodeSchema).min(1)
});
export type LatencyJob = z.infer<typeof latencyJobSchema>;

export const latencyJobDetailSchema = latencyJobSchema.extend({
  targets: z.array(latencyJobTargetSchema),
  evaluation: monitorEvaluationSchema.nullable().optional(),
  summary: z.object({
    total: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    inflight: z.number().int().nonnegative()
  })
});
export type LatencyJobDetail = z.infer<typeof latencyJobDetailSchema>;

export const checkProfileRunResponseSchema = z.object({
  profile: checkProfileSchema,
  jobs: z.array(latencyJobDetailSchema)
});
export type CheckProfileRunResponse = z.infer<typeof checkProfileRunResponseSchema>;

export const checkProfileRunDetailResponseSchema = z.object({
  profile: checkProfileSchema,
  run: checkProfileRunSchema,
  jobs: z.array(latencyJobDetailSchema)
});
export type CheckProfileRunDetailResponse = z.infer<typeof checkProfileRunDetailResponseSchema>;

const nullableNumberSchema = z.number().nullable();
const nullableStatusCodeSchema = z.number().int().min(100).max(599).nullable();

export const checkProfileRegionComparisonSchema = z.object({
  region: regionCodeSchema,
  currentJobId: z.string().min(1).nullable(),
  previousJobId: z.string().min(1).nullable(),
  currentStatus: jobStatusSchema.nullable(),
  previousStatus: jobStatusSchema.nullable(),
  currentLatencyMs: nullableNumberSchema,
  previousLatencyMs: nullableNumberSchema,
  currentStatusCode: nullableStatusCodeSchema,
  previousStatusCode: nullableStatusCodeSchema,
  currentFinalUrl: z.string().url().nullable(),
  previousFinalUrl: z.string().url().nullable(),
  currentProbeImpl: probeImplementationSchema.nullable(),
  previousProbeImpl: probeImplementationSchema.nullable(),
  currentErrorMessage: z.string().min(1).nullable(),
  previousErrorMessage: z.string().min(1).nullable(),
  latencyDeltaMs: nullableNumberSchema,
  latencyDeltaPct: nullableNumberSchema,
  classification: z.enum(['improved', 'regressed', 'unchanged', 'missing_previous', 'missing_current']),
  statusChanged: z.boolean()
});
export type CheckProfileRegionComparison = z.infer<typeof checkProfileRegionComparisonSchema>;

export const checkProfileRouteComparisonSchema = z.object({
  routeId: z.string().min(1),
  routeLabel: z.string().min(1).max(120),
  url: z.string().url(),
  regions: z.array(checkProfileRegionComparisonSchema).min(1)
});
export type CheckProfileRouteComparison = z.infer<typeof checkProfileRouteComparisonSchema>;

export const checkProfileComparisonSummarySchema = z.object({
  routesCompared: z.number().int().nonnegative(),
  regionsCompared: z.number().int().nonnegative(),
  improved: z.number().int().nonnegative(),
  regressed: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  missingPrevious: z.number().int().nonnegative(),
  missingCurrent: z.number().int().nonnegative()
});
export type CheckProfileComparisonSummary = z.infer<typeof checkProfileComparisonSummarySchema>;

export const checkProfileComparisonModeSchema = z.enum(['latest_previous', 'baseline', 'custom']);
export type CheckProfileComparisonMode = z.infer<typeof checkProfileComparisonModeSchema>;

export const checkProfileComparisonResponseSchema = z.object({
  profile: checkProfileSchema,
  currentRun: checkProfileRunSchema,
  comparedRun: checkProfileRunSchema.nullable(),
  mode: checkProfileComparisonModeSchema,
  summary: checkProfileComparisonSummarySchema,
  routes: z.array(checkProfileRouteComparisonSchema)
});
export type CheckProfileComparisonResponse = z.infer<typeof checkProfileComparisonResponseSchema>;

export const checkProfileBaselineResponseSchema = z.object({
  profile: checkProfileSchema,
  baselineRun: checkProfileRunSchema.nullable()
});
export type CheckProfileBaselineResponse = z.infer<typeof checkProfileBaselineResponseSchema>;

export const checkProfileLatestComparisonResponseSchema = z.object({
  profile: checkProfileSchema,
  currentRun: checkProfileRunSchema,
  previousRun: checkProfileRunSchema.nullable(),
  comparedRun: checkProfileRunSchema.nullable(),
  baselineRun: checkProfileRunSchema.nullable(),
  mode: checkProfileComparisonModeSchema,
  summary: checkProfileComparisonSummarySchema,
  routes: z.array(checkProfileRouteComparisonSchema)
});
export type CheckProfileLatestComparisonResponse = z.infer<typeof checkProfileLatestComparisonResponseSchema>;

export const checkProfileRunReportSummarySchema = z.object({
  runId: z.string().min(1),
  createdAt: z.string().datetime(),
  trigger: checkProfileRunTriggerSchema,
  routeCount: z.number().int().positive(),
  jobCount: z.number().int().nonnegative(),
  status: monitorStatusSchema,
  evaluation: monitorEvaluationSchema.nullable(),
  alertDeliveries: z.array(checkProfileAlertDeliverySchema),
  baselinePinned: z.boolean()
});
export type CheckProfileRunReportSummary = z.infer<typeof checkProfileRunReportSummarySchema>;

export const checkProfileReportResponseSchema = z.object({
  profile: checkProfileSchema,
  latestRun: checkProfileRunDetailResponseSchema.nullable(),
  latestRunSummary: checkProfileRunReportSummarySchema.nullable(),
  latestComparison: checkProfileLatestComparisonResponseSchema.nullable(),
  baselineComparison: checkProfileComparisonResponseSchema.nullable(),
  recentRuns: z.array(checkProfileRunReportSummarySchema)
});
export type CheckProfileReportResponse = z.infer<typeof checkProfileReportResponseSchema>;

export const reportExportFormatSchema = z.enum(['json', 'csv']);
export type ReportExportFormat = z.infer<typeof reportExportFormatSchema>;

export const reportExportScopeSchema = z.enum(['latest', 'baseline', 'recent', 'full']);
export type ReportExportScope = z.infer<typeof reportExportScopeSchema>;

export const comparisonTargetSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('baseline')
  }),
  z.object({
    type: z.literal('latest_previous')
  }),
  z.object({
    type: z.literal('run'),
    runId: z.string().min(1)
  })
]);
export type ComparisonTarget = z.infer<typeof comparisonTargetSchema>;

export const createComparisonInputSchema = z.object({
  checkId: z.string().min(1),
  runId: z.string().min(1),
  target: comparisonTargetSchema.default({ type: 'latest_previous' })
});
export type CreateComparisonInput = z.infer<typeof createComparisonInputSchema>;

export const comparisonResourceSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  checkId: z.string().min(1),
  currentRun: checkProfileRunSchema,
  comparedRun: checkProfileRunSchema.nullable(),
  mode: checkProfileComparisonModeSchema,
  summary: checkProfileComparisonSummarySchema,
  routes: z.array(checkProfileRouteComparisonSchema)
});
export type ComparisonResource = z.infer<typeof comparisonResourceSchema>;

export const comparisonListResponseSchema = z.object({
  comparisons: z.array(comparisonResourceSchema),
  pageInfo: pageInfoSchema
});
export type ComparisonListResponse = z.infer<typeof comparisonListResponseSchema>;

export const exportSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('check_report'),
    checkId: z.string().min(1)
  }),
  z.object({
    type: z.literal('comparison'),
    comparisonId: z.string().min(1)
  })
]);
export type ExportSource = z.infer<typeof exportSourceSchema>;

export const createExportInputSchema = z.object({
  source: exportSourceSchema,
  format: reportExportFormatSchema.default('json')
});
export type CreateExportInput = z.infer<typeof createExportInputSchema>;

export const exportStatusSchema = z.enum(['pending', 'succeeded', 'failed']);
export type ExportStatus = z.infer<typeof exportStatusSchema>;

export const exportResourceSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  source: exportSourceSchema,
  format: reportExportFormatSchema,
  status: exportStatusSchema,
  filename: z.string().min(1),
  contentType: z.string().min(1),
  body: z.string()
});
export type ExportResource = z.infer<typeof exportResourceSchema>;

export const exportListResponseSchema = z.object({
  exports: z.array(exportResourceSchema),
  pageInfo: pageInfoSchema
});
export type ExportListResponse = z.infer<typeof exportListResponseSchema>;

export const analysisSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('comparison'),
    comparisonId: z.string().min(1)
  }),
  z.object({
    type: z.literal('run'),
    runId: z.string().min(1),
    checkId: z.string().min(1)
  })
]);
export type AnalysisSource = z.infer<typeof analysisSourceSchema>;

export const analysisKindSchema = z.enum(['regression_summary']);
export type AnalysisKind = z.infer<typeof analysisKindSchema>;

export const createAnalysisInputSchema = z.object({
  source: analysisSourceSchema,
  kind: analysisKindSchema.default('regression_summary')
});
export type CreateAnalysisInput = z.infer<typeof createAnalysisInputSchema>;

export const analysisFindingSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']),
  summary: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)).default([])
});
export type AnalysisFinding = z.infer<typeof analysisFindingSchema>;

export const analysisRecommendationSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  summary: z.string().min(1)
});
export type AnalysisRecommendation = z.infer<typeof analysisRecommendationSchema>;

export const analysisOutputSchema = z.object({
  findings: z.array(analysisFindingSchema),
  recommendations: z.array(analysisRecommendationSchema),
  narrative: z.string().min(1).nullable().default(null)
});
export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;

export const analysisResourceSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  source: analysisSourceSchema,
  kind: analysisKindSchema,
  status: z.enum(['pending', 'running', 'succeeded', 'failed']),
  output: analysisOutputSchema,
  generator: z.object({
    type: z.enum(['rule_engine']),
    version: z.string().min(1)
  })
});
export type AnalysisResource = z.infer<typeof analysisResourceSchema>;

export const analysisListResponseSchema = z.object({
  analyses: z.array(analysisResourceSchema),
  pageInfo: pageInfoSchema
});
export type AnalysisListResponse = z.infer<typeof analysisListResponseSchema>;

export const schedulerDispatchResponseSchema = z.object({
  dispatchedAt: z.string().datetime(),
  triggeredCount: z.number().int().nonnegative(),
  triggeredProfiles: z.array(
    z.object({
      profileId: z.string().min(1),
      jobIds: z.array(z.string().min(1)).min(1),
      nextRunAt: z.string().datetime().nullable()
    })
  )
});
export type SchedulerDispatchResponse = z.infer<typeof schedulerDispatchResponseSchema>;

export const jobListResponseSchema = z.object({
  jobs: z.array(latencyJobSchema),
  pageInfo: pageInfoSchema
});
export type JobListResponse = z.infer<typeof jobListResponseSchema>;

export const regionsResponseSchema = z.object({
  regions: z.array(regionAvailabilitySchema)
});
export type RegionsResponse = z.infer<typeof regionsResponseSchema>;

export const jobSnapshotEventSchema = z.object({
  type: z.literal('job.snapshot'),
  job: latencyJobDetailSchema
});
export type JobSnapshotEvent = z.infer<typeof jobSnapshotEventSchema>;

export const controlPlaneHealthSchema = z.object({
  service: z.string().min(1),
  ok: z.boolean(),
  batchMode: z.enum(['ondemand', 'batch', 'always_on']),
  regionCatalogSize: z.number().int().nonnegative(),
  selectableRegions: z.array(regionCodeSchema),
  slotPoolSize: z.number().int().nonnegative(),
  features: z.record(z.string(), z.boolean()),
  bindings: z.record(z.string(), z.boolean()),
  slotInventory: z.array(
    z.object({
      slotId: z.string().min(1),
      currentRegion: regionCodeSchema.nullable(),
      currentStatus: z.enum(['unknown', 'active', 'progressing', 'inactive', 'failing', 'suspended']),
      desiredImage: z.string().min(1).nullable(),
      currentImage: z.string().min(1).nullable(),
      leaseActive: z.boolean(),
      leaseExpiresAt: z.string().datetime().nullable(),
      graceUntil: z.string().datetime().nullable(),
      lastHealthyAt: z.string().datetime().nullable()
    })
  ),
  requiredSecrets: z.object({
    probeCurrent: z.boolean(),
    bunnyAccessKey: z.boolean(),
    turnstileSecret: z.boolean(),
    opsSharedSecret: z.boolean()
  }),
  lastSuccessfulSmoke: z
    .object({
      at: z.string().datetime(),
      region: regionCodeSchema,
      slotId: z.string().min(1),
      probeImpl: probeImplementationSchema,
      ok: z.boolean()
    })
    .nullable()
});
export type ControlPlaneHealth = z.infer<typeof controlPlaneHealthSchema>;
