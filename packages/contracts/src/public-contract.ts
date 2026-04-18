import { oc, populateContractRouterPaths, type as orpcType } from '@orpc/contract';
import { z } from 'zod';
import {
  analysisListResponseSchema,
  analysisResourceSchema,
  browserAuditListResponseSchema,
  browserAuditResourceSchema,
  checkProfileBaselineResponseSchema,
  checkProfileListResponseSchema,
  checkProfileRunListResponseSchema,
  comparisonResourceSchema,
  comparisonListResponseSchema,
  createAnalysisInputSchema,
  createBrowserAuditInputSchema,
  checkProfileRunDetailResponseSchema,
  checkProfileRunResponseSchema,
  checkProfileSchema,
  createComparisonInputSchema,
  createCheckProfileSchema,
  createExportInputSchema,
  createPropertySchema,
  createRegionPackSchema,
  createRouteSetSchema,
  exportListResponseSchema,
  exportResourceSchema,
  listQuerySchema,
  pageInfoSchema,
  propertySchema,
  propertyListResponseSchema,
  regionPackSchema,
  regionsResponseSchema,
  regionPackListResponseSchema,
  routeSetListResponseSchema,
  routeSetSchema,
  setCheckProfileBaselineSchema,
  updateCheckProfileSchema,
  updatePropertySchema,
  updateRegionPackSchema,
  updateRouteSetSchema
} from './public-api';

const siteIdSchema = z.object({
  siteId: z.string().min(1)
});

const routeGroupIdSchema = z.object({
  routeGroupId: z.string().min(1)
});

const regionSetIdSchema = z.object({
  regionSetId: z.string().min(1)
});

const checkIdSchema = z.object({
  checkId: z.string().min(1)
});

const listInputSchema = z.object({
  query: listQuerySchema.optional()
});

const runIdSchema = z.object({
  runId: z.string().min(1)
});

const publicCapabilitiesSchema = z.object({
  deploymentModel: z.enum(['selfhost', 'managed']),
  features: z.object({
    managedRegions: z.boolean(),
    scheduledChecks: z.boolean(),
    baselineCompare: z.boolean(),
    reportExports: z.boolean(),
    webhookAlerts: z.boolean(),
    browserAuditDirectRun: z.boolean(),
    aiAnalyses: z.boolean(),
    openApi: z.boolean(),
    appRpc: z.boolean(),
    opsRpc: z.boolean()
  })
});

const sitesResponseSchema = z.object({
  sites: z.array(propertySchema),
  pageInfo: pageInfoSchema
});

const siteMutationResponseSchema = z.object({
  site: propertySchema
});

const routeGroupsResponseSchema = z.object({
  routeGroups: z.array(routeSetSchema),
  pageInfo: pageInfoSchema
});

const routeGroupMutationResponseSchema = z.object({
  routeGroup: routeSetSchema
});

const regionSetsResponseSchema = z.object({
  regionSets: z.array(regionPackSchema),
  pageInfo: pageInfoSchema
});

const regionSetMutationResponseSchema = z.object({
  regionSet: regionPackSchema
});

const checksResponseSchema = z.object({
  checks: z.array(checkProfileSchema),
  pageInfo: pageInfoSchema
});

const checkMutationResponseSchema = z.object({
  check: checkProfileSchema
});

const checkBaselineResponseSchema = z.object({
  check: checkProfileSchema,
  baselineRun: checkProfileBaselineResponseSchema.shape.baselineRun
});

const checkRunCreateResponseSchema = z.object({
  check: checkProfileSchema,
  jobs: checkProfileRunResponseSchema.shape.jobs
});

export const PUBLIC_OPENAPI_TAG_DEFINITIONS = [
  { name: 'capabilities', description: 'Feature and deployment capability discovery.' },
  { name: 'catalog', description: 'Region catalog and availability.' },
  { name: 'sites', description: 'Site configuration resources.' },
  { name: 'routeGroups', description: 'Representative route group resources.' },
  { name: 'regionSets', description: 'Named region set resources.' },
  { name: 'checks', description: 'Checks, baselines, and check-triggered runs.' },
  { name: 'runs', description: 'Resolved run details.' },
  { name: 'comparisons', description: 'Derived comparison resources.' },
  { name: 'exports', description: 'Derived export resources.' },
  { name: 'analyses', description: 'Derived analysis resources.' },
  { name: 'browserAudits', description: 'Optional direct-run browser audit resources.' }
] as const;

export const publicContract = populateContractRouterPaths(
  oc.router({
    capabilities: {
      get: oc
        .input(orpcType<void>())
        .output(publicCapabilitiesSchema)
        .route({
          method: 'GET',
          path: '/v1/capabilities',
          summary: 'Get public API capabilities',
          tags: ['capabilities']
        })
    },
    regions: {
      list: oc
        .input(orpcType<void>())
        .output(regionsResponseSchema)
        .route({
          method: 'GET',
          path: '/v1/regions',
          summary: 'List public regions',
          tags: ['catalog']
        })
    },
    sites: {
      list: oc
        .input(listInputSchema)
        .output(sitesResponseSchema)
        .route({
          method: 'GET',
          path: '/v1/sites',
          inputStructure: 'detailed',
          summary: 'List sites',
          tags: ['sites']
        }),
      create: oc
        .input(createPropertySchema)
        .output(siteMutationResponseSchema)
        .route({
          method: 'POST',
          path: '/v1/sites',
          summary: 'Create site',
          tags: ['sites']
        }),
      get: oc
        .input(z.object({ params: siteIdSchema }))
        .output(propertySchema)
        .route({
          method: 'GET',
          path: '/v1/sites/{siteId}',
          inputStructure: 'detailed',
          summary: 'Get site',
          tags: ['sites']
        }),
      update: oc
        .input(
          z.object({
            params: siteIdSchema,
            body: updatePropertySchema
          })
        )
        .output(siteMutationResponseSchema)
        .route({
          method: 'PATCH',
          path: '/v1/sites/{siteId}',
          inputStructure: 'detailed',
          summary: 'Update site',
          tags: ['sites']
        }),
      remove: oc
        .input(z.object({ params: siteIdSchema }))
        .output(z.object({ ok: z.boolean() }))
        .route({
          method: 'DELETE',
          path: '/v1/sites/{siteId}',
          inputStructure: 'detailed',
          summary: 'Delete site',
          tags: ['sites']
        })
    },
    routeGroups: {
      list: oc
        .input(listInputSchema)
        .output(routeGroupsResponseSchema)
        .route({
          method: 'GET',
          path: '/v1/route-groups',
          inputStructure: 'detailed',
          summary: 'List route groups',
          tags: ['routeGroups']
        }),
      create: oc
        .input(createRouteSetSchema)
        .output(routeGroupMutationResponseSchema)
        .route({
          method: 'POST',
          path: '/v1/route-groups',
          summary: 'Create route group',
          tags: ['routeGroups']
        }),
      get: oc
        .input(z.object({ params: routeGroupIdSchema }))
        .output(routeSetSchema)
        .route({
          method: 'GET',
          path: '/v1/route-groups/{routeGroupId}',
          inputStructure: 'detailed',
          summary: 'Get route group',
          tags: ['routeGroups']
        }),
      update: oc
        .input(
          z.object({
            params: routeGroupIdSchema,
            body: updateRouteSetSchema
          })
        )
        .output(routeGroupMutationResponseSchema)
        .route({
          method: 'PATCH',
          path: '/v1/route-groups/{routeGroupId}',
          inputStructure: 'detailed',
          summary: 'Update route group',
          tags: ['routeGroups']
        }),
      remove: oc
        .input(z.object({ params: routeGroupIdSchema }))
        .output(z.object({ ok: z.boolean() }))
        .route({
          method: 'DELETE',
          path: '/v1/route-groups/{routeGroupId}',
          inputStructure: 'detailed',
          summary: 'Delete route group',
          tags: ['routeGroups']
        })
    },
    regionSets: {
      list: oc
        .input(listInputSchema)
        .output(regionSetsResponseSchema)
        .route({
          method: 'GET',
          path: '/v1/region-sets',
          inputStructure: 'detailed',
          summary: 'List region sets',
          tags: ['regionSets']
        }),
      create: oc
        .input(createRegionPackSchema)
        .output(regionSetMutationResponseSchema)
        .route({
          method: 'POST',
          path: '/v1/region-sets',
          summary: 'Create region set',
          tags: ['regionSets']
        }),
      get: oc
        .input(z.object({ params: regionSetIdSchema }))
        .output(regionPackSchema)
        .route({
          method: 'GET',
          path: '/v1/region-sets/{regionSetId}',
          inputStructure: 'detailed',
          summary: 'Get region set',
          tags: ['regionSets']
        }),
      update: oc
        .input(
          z.object({
            params: regionSetIdSchema,
            body: updateRegionPackSchema
          })
        )
        .output(regionSetMutationResponseSchema)
        .route({
          method: 'PATCH',
          path: '/v1/region-sets/{regionSetId}',
          inputStructure: 'detailed',
          summary: 'Update region set',
          tags: ['regionSets']
        }),
      remove: oc
        .input(z.object({ params: regionSetIdSchema }))
        .output(z.object({ ok: z.boolean() }))
        .route({
          method: 'DELETE',
          path: '/v1/region-sets/{regionSetId}',
          inputStructure: 'detailed',
          summary: 'Delete region set',
          tags: ['regionSets']
        })
    },
    checks: {
      list: oc
        .input(listInputSchema)
        .output(checksResponseSchema)
        .route({
          method: 'GET',
          path: '/v1/checks',
          inputStructure: 'detailed',
          summary: 'List checks',
          tags: ['checks']
        }),
      create: oc
        .input(createCheckProfileSchema)
        .output(checkMutationResponseSchema)
        .route({
          method: 'POST',
          path: '/v1/checks',
          summary: 'Create check',
          tags: ['checks']
        }),
      get: oc
        .input(z.object({ params: checkIdSchema }))
        .output(checkProfileSchema)
        .route({
          method: 'GET',
          path: '/v1/checks/{checkId}',
          inputStructure: 'detailed',
          summary: 'Get check',
          tags: ['checks']
        }),
      update: oc
        .input(
          z.object({
            params: checkIdSchema,
            body: updateCheckProfileSchema
          })
        )
        .output(checkMutationResponseSchema)
        .route({
          method: 'PATCH',
          path: '/v1/checks/{checkId}',
          inputStructure: 'detailed',
          summary: 'Update check',
          tags: ['checks']
        }),
      remove: oc
        .input(z.object({ params: checkIdSchema }))
        .output(z.object({ ok: z.boolean(), deletedRunCount: z.number().int().nonnegative() }))
        .route({
          method: 'DELETE',
          path: '/v1/checks/{checkId}',
          inputStructure: 'detailed',
          summary: 'Delete check',
          tags: ['checks']
        }),
      baseline: {
        get: oc
          .input(z.object({ params: checkIdSchema }))
          .output(checkBaselineResponseSchema)
          .route({
            method: 'GET',
            path: '/v1/checks/{checkId}/baseline',
            inputStructure: 'detailed',
            summary: 'Get check baseline',
            tags: ['checks']
          }),
        set: oc
          .input(
            z.object({
              params: checkIdSchema,
              body: setCheckProfileBaselineSchema
            })
          )
          .output(checkBaselineResponseSchema)
          .route({
            method: 'PUT',
            path: '/v1/checks/{checkId}/baseline',
            inputStructure: 'detailed',
            summary: 'Set check baseline',
            tags: ['checks']
          }),
        clear: oc
          .input(z.object({ params: checkIdSchema }))
          .output(checkBaselineResponseSchema)
          .route({
            method: 'DELETE',
            path: '/v1/checks/{checkId}/baseline',
            inputStructure: 'detailed',
            summary: 'Clear check baseline',
            tags: ['checks']
          })
      },
      runs: {
        list: oc
          .input(z.object({ params: checkIdSchema, query: listQuerySchema.optional() }))
          .output(checkProfileRunListResponseSchema)
          .route({
            method: 'GET',
            path: '/v1/checks/{checkId}/runs',
            inputStructure: 'detailed',
            summary: 'List check runs',
            tags: ['checks']
          }),
        create: oc
          .input(z.object({ params: checkIdSchema }))
          .output(checkRunCreateResponseSchema)
          .route({
            method: 'POST',
            path: '/v1/checks/{checkId}/runs',
            inputStructure: 'detailed',
            summary: 'Create check run',
            tags: ['checks']
          })
      }
    },
    runs: {
      get: oc
        .input(z.object({ params: runIdSchema }))
        .output(
          z.object({
            check: checkProfileRunDetailResponseSchema.shape.profile,
            run: checkProfileRunDetailResponseSchema.shape.run,
            jobs: checkProfileRunDetailResponseSchema.shape.jobs
          })
        )
        .route({
          method: 'GET',
          path: '/v1/runs/{runId}',
          inputStructure: 'detailed',
          summary: 'Get run',
          tags: ['runs']
        })
    },
    comparisons: {
      list: oc
        .input(listInputSchema)
        .output(comparisonListResponseSchema)
        .route({
          method: 'GET',
          path: '/v1/comparisons',
          inputStructure: 'detailed',
          summary: 'List comparisons',
          tags: ['comparisons']
        }),
      create: oc
        .input(createComparisonInputSchema)
        .output(comparisonResourceSchema)
        .route({
          method: 'POST',
          path: '/v1/comparisons',
          summary: 'Create comparison',
          tags: ['comparisons']
        }),
      get: oc
        .input(z.object({ params: z.object({ comparisonId: z.string().min(1) }) }))
        .output(comparisonResourceSchema)
        .route({
          method: 'GET',
          path: '/v1/comparisons/{comparisonId}',
          inputStructure: 'detailed',
          summary: 'Get comparison',
          tags: ['comparisons']
        })
    },
    exports: {
      list: oc
        .input(listInputSchema)
        .output(exportListResponseSchema)
        .route({
          method: 'GET',
          path: '/v1/exports',
          inputStructure: 'detailed',
          summary: 'List exports',
          tags: ['exports']
        }),
      create: oc
        .input(createExportInputSchema)
        .output(exportResourceSchema)
        .route({
          method: 'POST',
          path: '/v1/exports',
          summary: 'Create export',
          tags: ['exports']
        }),
      get: oc
        .input(z.object({ params: z.object({ exportId: z.string().min(1) }) }))
        .output(exportResourceSchema)
        .route({
          method: 'GET',
          path: '/v1/exports/{exportId}',
          inputStructure: 'detailed',
          summary: 'Get export',
          tags: ['exports']
        })
    },
    analyses: {
      list: oc
        .input(listInputSchema)
        .output(analysisListResponseSchema)
        .route({
          method: 'GET',
          path: '/v1/analyses',
          inputStructure: 'detailed',
          summary: 'List analyses',
          tags: ['analyses']
        }),
      create: oc
        .input(createAnalysisInputSchema)
        .output(analysisResourceSchema)
        .route({
          method: 'POST',
          path: '/v1/analyses',
          summary: 'Create analysis',
          tags: ['analyses']
        }),
      get: oc
        .input(z.object({ params: z.object({ analysisId: z.string().min(1) }) }))
        .output(analysisResourceSchema)
        .route({
          method: 'GET',
          path: '/v1/analyses/{analysisId}',
          inputStructure: 'detailed',
          summary: 'Get analysis',
          tags: ['analyses']
        })
    },
    browserAudits: {
      list: oc
        .input(listInputSchema)
        .output(browserAuditListResponseSchema)
        .route({
          method: 'GET',
          path: '/v1/browser-audits',
          inputStructure: 'detailed',
          summary: 'List browser audits',
          tags: ['browserAudits']
        }),
      create: oc
        .input(createBrowserAuditInputSchema)
        .output(browserAuditResourceSchema)
        .route({
          method: 'POST',
          path: '/v1/browser-audits',
          summary: 'Create browser audit',
          tags: ['browserAudits']
        }),
      get: oc
        .input(z.object({ params: z.object({ auditId: z.string().min(1) }) }))
        .output(browserAuditResourceSchema)
        .route({
          method: 'GET',
          path: '/v1/browser-audits/{auditId}',
          inputStructure: 'detailed',
          summary: 'Get browser audit',
          tags: ['browserAudits']
        })
    }
  })
);

export type PublicContract = typeof publicContract;
export type PublicCapabilities = z.infer<typeof publicCapabilitiesSchema>;
