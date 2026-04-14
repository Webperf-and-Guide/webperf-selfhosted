import { z } from 'zod';
import { regionCodeSchema } from './regions';

export const browserAuditDslVersion = 'v1' as const;

export const browserAuditPresetSchema = z.enum(['mobile', 'desktop']);
export type BrowserAuditPreset = z.infer<typeof browserAuditPresetSchema>;

export const browserAuditProviderClassSchema = z.enum(['best_effort', 'fixed']);
export type BrowserAuditProviderClass = z.infer<typeof browserAuditProviderClassSchema>;

export const browserAuditArtifactKindSchema = z.enum(['json', 'html', 'screenshot', 'trace']);
export type BrowserAuditArtifactKind = z.infer<typeof browserAuditArtifactKindSchema>;

export const browserAuditCheckpointModeSchema = z.enum(['navigation', 'snapshot', 'timespan']);
export type BrowserAuditCheckpointMode = z.infer<typeof browserAuditCheckpointModeSchema>;

export const browserAuditIssueSeveritySchema = z.enum(['info', 'warning', 'error']);
export type BrowserAuditIssueSeverity = z.infer<typeof browserAuditIssueSeveritySchema>;

export const browserAuditExecutionStatusSchema = z.enum([
  'queued',
  'provisioning',
  'running',
  'uploading',
  'succeeded',
  'failed',
  'cancelled'
]);
export type BrowserAuditExecutionStatus = z.infer<typeof browserAuditExecutionStatusSchema>;

export const browserAuditHeaderSchema = z.object({
  name: z.string().min(1).max(120),
  value: z.string().max(4_000)
});
export type BrowserAuditHeader = z.infer<typeof browserAuditHeaderSchema>;

export const browserAuditCookieSchema = z.object({
  name: z.string().min(1).max(120),
  value: z.string().max(4_000),
  url: z.string().url().optional(),
  domain: z.string().min(1).max(255).optional(),
  path: z.string().min(1).max(255).optional(),
  expires: z.number().finite().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  sameSite: z.enum(['Strict', 'Lax', 'None']).optional()
});
export type BrowserAuditCookie = z.infer<typeof browserAuditCookieSchema>;

export const browserAuditViewportStepSchema = z.object({
  type: z.literal('setViewport'),
  width: z.number().int().min(320).max(2560),
  height: z.number().int().min(320).max(2560),
  deviceScaleFactor: z.number().positive().max(4).optional(),
  isMobile: z.boolean().optional(),
  hasTouch: z.boolean().optional()
});
export type BrowserAuditViewportStep = z.infer<typeof browserAuditViewportStepSchema>;

export const browserAuditFlowStepSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('navigate'),
    url: z.string().url().optional(),
    label: z.string().min(1).max(120).optional()
  }),
  z.object({
    type: z.literal('waitForSelector'),
    selector: z.string().min(1).max(500),
    state: z.enum(['attached', 'visible', 'hidden', 'detached']).optional()
  }),
  z.object({
    type: z.literal('waitForUrl'),
    url: z.string().min(1).max(500),
    match: z.enum(['equals', 'includes', 'regex']).default('equals')
  }),
  z.object({
    type: z.literal('click'),
    selector: z.string().min(1).max(500)
  }),
  z.object({
    type: z.literal('type'),
    selector: z.string().min(1).max(500),
    text: z.string().max(10_000),
    clear: z.boolean().default(false)
  }),
  z.object({
    type: z.literal('press'),
    key: z.string().min(1).max(120)
  }),
  z.object({
    type: z.literal('select'),
    selector: z.string().min(1).max(500),
    values: z.array(z.string().min(1).max(200)).min(1).max(20)
  }),
  z.object({
    type: z.literal('waitForTimeout'),
    ms: z.number().int().min(0).max(60_000)
  }),
  browserAuditViewportStepSchema,
  z.object({
    type: z.literal('setCookie'),
    cookie: browserAuditCookieSchema
  }),
  z.object({
    type: z.literal('setExtraHeaders'),
    headers: z.array(browserAuditHeaderSchema).min(1).max(20)
  }),
  z.object({
    type: z.literal('snapshot'),
    label: z.string().min(1).max(120).optional()
  }),
  z.object({
    type: z.literal('timespanStart'),
    label: z.string().min(1).max(120).optional()
  }),
  z.object({
    type: z.literal('timespanEnd'),
    label: z.string().min(1).max(120).optional()
  })
]);
export type BrowserAuditFlowStep = z.infer<typeof browserAuditFlowStepSchema>;

export const browserAuditFlowDslSchema = z
  .object({
    version: z.literal(browserAuditDslVersion).default(browserAuditDslVersion),
    steps: z.array(browserAuditFlowStepSchema).min(1).max(20)
  })
  .superRefine((value, context) => {
    let navigateCount = 0;
    let activeTimespan = false;
    let checkpointCount = 0;

    value.steps.forEach((step, index) => {
      if (step.type === 'navigate') {
        navigateCount += 1;
        checkpointCount += 1;
      }

      if (step.type === 'snapshot') {
        checkpointCount += 1;
      }

      if (step.type === 'timespanStart') {
        if (activeTimespan) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'timespanStart cannot be nested',
            path: ['steps', index]
          });
        }
        activeTimespan = true;
      }

      if (step.type === 'timespanEnd') {
        if (!activeTimespan) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'timespanEnd must follow timespanStart',
            path: ['steps', index]
          });
        } else {
          activeTimespan = false;
          checkpointCount += 1;
        }
      }
    });

    if (navigateCount !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Flow must include exactly one navigate step',
        path: ['steps']
      });
    }

    if (activeTimespan) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Flow cannot end with an open timespan',
        path: ['steps']
      });
    }

    if (checkpointCount > 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Flow can include one navigation plus up to two additional checkpoints',
        path: ['steps']
      });
    }
  });
export type BrowserAuditFlowDsl = z.infer<typeof browserAuditFlowDslSchema>;

export const browserAuditArtifactsConfigSchema = z.object({
  json: z.boolean().default(true),
  html: z.boolean().default(true),
  screenshot: z.boolean().default(false),
  trace: z.boolean().default(false)
});
export type BrowserAuditArtifactsConfig = z.infer<typeof browserAuditArtifactsConfigSchema>;

export const browserAuditTimeoutsSchema = z.object({
  totalTimeoutMs: z.number().int().min(5_000).max(120_000).default(120_000),
  stepTimeoutMs: z.number().int().min(1_000).max(30_000).default(10_000)
});
export type BrowserAuditTimeouts = z.infer<typeof browserAuditTimeoutsSchema>;

export const browserAuditPolicySchema = z.object({
  enabled: z.boolean().default(true),
  required: z.boolean().default(false),
  preset: browserAuditPresetSchema.default('mobile'),
  providerClass: browserAuditProviderClassSchema.default('fixed'),
  artifacts: browserAuditArtifactsConfigSchema.default({
    json: true,
    html: true,
    screenshot: false,
    trace: false
  }),
  timeouts: browserAuditTimeoutsSchema.default({
    totalTimeoutMs: 120_000,
    stepTimeoutMs: 10_000
  }),
  flow: browserAuditFlowDslSchema
});
export type BrowserAuditPolicy = z.infer<typeof browserAuditPolicySchema>;

export const browserAuditMetricSummarySchema = z.object({
  finalUrl: z.string().url().nullable().default(null),
  statusCode: z.number().int().min(100).max(599).nullable().default(null),
  performanceScore: z.number().min(0).max(1).nullable().default(null),
  accessibilityScore: z.number().min(0).max(1).nullable().default(null),
  bestPracticesScore: z.number().min(0).max(1).nullable().default(null),
  seoScore: z.number().min(0).max(1).nullable().default(null),
  fcpMs: z.number().nonnegative().nullable().default(null),
  lcpMs: z.number().nonnegative().nullable().default(null),
  cls: z.number().nonnegative().nullable().default(null),
  inpMs: z.number().nonnegative().nullable().default(null),
  tbtMs: z.number().nonnegative().nullable().default(null),
  speedIndexMs: z.number().nonnegative().nullable().default(null)
});
export type BrowserAuditMetricSummary = z.infer<typeof browserAuditMetricSummarySchema>;

export const browserAuditIssueSchema = z.object({
  code: z.string().min(1).max(120),
  severity: browserAuditIssueSeveritySchema,
  message: z.string().min(1).max(1_000)
});
export type BrowserAuditIssue = z.infer<typeof browserAuditIssueSchema>;

export const browserAuditArtifactRefSchema = z.object({
  id: z.string().min(1),
  kind: browserAuditArtifactKindSchema,
  url: z.string().min(1),
  contentType: z.string().min(1).max(200),
  byteSize: z.number().int().nonnegative().nullable().default(null),
  createdAt: z.string().datetime()
});
export type BrowserAuditArtifactRef = z.infer<typeof browserAuditArtifactRefSchema>;

export const browserAuditToolchainSchema = z.object({
  flowDslVersion: z.literal(browserAuditDslVersion).default(browserAuditDslVersion),
  bunVersion: z.string().min(1),
  chromeVersion: z.string().min(1),
  puppeteerVersion: z.string().min(1),
  lighthouseVersion: z.string().min(1)
});
export type BrowserAuditToolchain = z.infer<typeof browserAuditToolchainSchema>;

export const browserAuditCheckpointResultSchema = z.object({
  id: z.string().min(1),
  mode: browserAuditCheckpointModeSchema,
  label: z.string().min(1).max(120).nullable().default(null),
  summary: browserAuditMetricSummarySchema
});
export type BrowserAuditCheckpointResult = z.infer<typeof browserAuditCheckpointResultSchema>;

export const browserAuditResultSchema = z.object({
  summary: browserAuditMetricSummarySchema,
  checkpoints: z.array(browserAuditCheckpointResultSchema).max(3).default([]),
  issues: z.array(browserAuditIssueSchema).default([]),
  artifacts: z.array(browserAuditArtifactRefSchema).default([]),
  toolchain: browserAuditToolchainSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime()
});
export type BrowserAuditResult = z.infer<typeof browserAuditResultSchema>;

export const browserAuditRunSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative()
});
export type BrowserAuditRunSummary = z.infer<typeof browserAuditRunSummarySchema>;

export const browserAuditExecutionSummarySchema = z.object({
  executionId: z.string().min(1),
  status: browserAuditExecutionStatusSchema,
  region: regionCodeSchema.nullable().default(null),
  result: browserAuditResultSchema.nullable().default(null),
  requestedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable().default(null),
  completedAt: z.string().datetime().nullable().default(null)
});
export type BrowserAuditExecutionSummary = z.infer<typeof browserAuditExecutionSummarySchema>;

export const browserAuditArtifactUploadConfigSchema = z.object({
  baseUrl: z.string().url(),
  bearerToken: z.string().min(1)
});
export type BrowserAuditArtifactUploadConfig = z.infer<typeof browserAuditArtifactUploadConfigSchema>;

export const browserAuditWorkerRequestSchema = z.object({
  executionId: z.string().min(1),
  targetUrl: z.string().url(),
  region: regionCodeSchema.nullable().default(null),
  policy: browserAuditPolicySchema,
  customHeaders: z.array(browserAuditHeaderSchema).max(20).default([]),
  cookies: z.array(browserAuditCookieSchema).max(20).default([]),
  artifactUpload: browserAuditArtifactUploadConfigSchema.nullable().default(null),
  timestamp: z.string().datetime(),
  signature: z.string().regex(/^[a-f0-9]+$/),
  keyVersion: z.enum(['current', 'next']).default('current')
});
export type BrowserAuditWorkerRequest = z.infer<typeof browserAuditWorkerRequestSchema>;

export const browserAuditWorkerResponseSchema = z.object({
  executionId: z.string().min(1),
  status: z.enum(['succeeded', 'failed']),
  result: browserAuditResultSchema.nullable().default(null),
  error: z.string().min(1).nullable().default(null)
});
export type BrowserAuditWorkerResponse = z.infer<typeof browserAuditWorkerResponseSchema>;

export const browserAuditCapabilitiesSchema = z.object({
  flowDslVersion: z.literal(browserAuditDslVersion).default(browserAuditDslVersion),
  toolchain: browserAuditToolchainSchema,
  supportedCheckpointModes: z.array(browserAuditCheckpointModeSchema).default([
    'navigation',
    'snapshot',
    'timespan'
  ]),
  supportedArtifactKinds: z.array(browserAuditArtifactKindSchema).default([
    'json',
    'html',
    'screenshot',
    'trace'
  ]),
  unsupportedFeatures: z.array(z.string().min(1)).default([]),
  limits: z.object({
    maxSteps: z.number().int().positive().default(20),
    maxCheckpoints: z.number().int().positive().default(3),
    maxPages: z.number().int().positive().default(1),
    maxContexts: z.number().int().positive().default(1),
    maxArtifactBytes: z.number().int().positive().default(25_000_000),
    defaultTotalTimeoutMs: z.number().int().positive().default(120_000),
    defaultStepTimeoutMs: z.number().int().positive().default(10_000)
  })
});
export type BrowserAuditCapabilities = z.infer<typeof browserAuditCapabilitiesSchema>;
