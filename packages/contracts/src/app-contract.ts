import { oc, populateContractRouterPaths, type as orpcType } from '@orpc/contract';
import { z } from 'zod';
import {
  analysisListResponseSchema,
  createExportInputSchema,
  checkProfileBaselineResponseSchema,
  checkProfileComparisonResponseSchema,
  checkProfileLatestComparisonResponseSchema,
  checkProfileListResponseSchema,
  checkProfileReportResponseSchema,
  checkProfileRunDetailResponseSchema,
  checkProfileRunListResponseSchema,
  checkProfileRunResponseSchema,
  checkProfileSchema,
  comparisonListResponseSchema,
  exportListResponseSchema,
  exportResourceSchema,
  createCheckProfileSchema,
  createPropertySchema,
  createRegionPackSchema,
  createRouteSetSchema,
  listQuerySchema,
  propertyListResponseSchema,
  propertySchema,
  regionPackListResponseSchema,
  regionPackSchema,
  regionsResponseSchema,
  routeSetListResponseSchema,
  routeSetSchema,
  setCheckProfileBaselineSchema,
  updateCheckProfileSchema,
  updatePropertySchema,
  updateRegionPackSchema,
  updateRouteSetSchema
} from './public-api';
import { controlHealthSchema } from './control-contract';

const idSchema = z.object({
  id: z.string().min(1)
});

const runParamsSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1)
});

const compareQuerySchema = z.object({
  against: z.enum(['baseline', 'previous', 'custom']).optional(),
  againstRunId: z.string().min(1).optional()
});

const listInputSchema = z.object({
  query: listQuerySchema.optional()
});

export const appContract = populateContractRouterPaths(
  oc.router({
    system: {
      health: oc
        .input(orpcType<void>())
        .output(controlHealthSchema)
        .route({
          method: 'GET',
          path: '/v1/health',
          summary: 'App health'
        }),
      regions: oc
        .input(orpcType<void>())
        .output(regionsResponseSchema)
        .route({
          method: 'GET',
          path: '/v1/regions',
          summary: 'App region catalog'
        })
    },
    properties: {
      list: oc.input(listInputSchema).output(propertyListResponseSchema).route({ method: 'GET', path: '/v1/properties', inputStructure: 'detailed' }),
      create: oc.input(createPropertySchema).output(z.object({ property: propertySchema })).route({ method: 'POST', path: '/v1/properties' }),
      get: oc.input(z.object({ params: idSchema })).output(propertySchema).route({ method: 'GET', path: '/v1/properties/{id}', inputStructure: 'detailed' }),
      update: oc.input(z.object({ params: idSchema, body: updatePropertySchema })).output(z.object({ property: propertySchema })).route({ method: 'PUT', path: '/v1/properties/{id}', inputStructure: 'detailed' }),
      delete: oc.input(z.object({ params: idSchema })).output(z.object({ ok: z.boolean() })).route({ method: 'DELETE', path: '/v1/properties/{id}', inputStructure: 'detailed' })
    },
    routeSets: {
      list: oc.input(listInputSchema).output(routeSetListResponseSchema).route({ method: 'GET', path: '/v1/route-sets', inputStructure: 'detailed' }),
      create: oc.input(createRouteSetSchema).output(z.object({ routeSet: routeSetSchema })).route({ method: 'POST', path: '/v1/route-sets' }),
      get: oc.input(z.object({ params: idSchema })).output(routeSetSchema).route({ method: 'GET', path: '/v1/route-sets/{id}', inputStructure: 'detailed' }),
      update: oc.input(z.object({ params: idSchema, body: updateRouteSetSchema })).output(z.object({ routeSet: routeSetSchema })).route({ method: 'PUT', path: '/v1/route-sets/{id}', inputStructure: 'detailed' }),
      delete: oc.input(z.object({ params: idSchema })).output(z.object({ ok: z.boolean() })).route({ method: 'DELETE', path: '/v1/route-sets/{id}', inputStructure: 'detailed' })
    },
    regionPacks: {
      list: oc.input(listInputSchema).output(regionPackListResponseSchema).route({ method: 'GET', path: '/v1/region-packs', inputStructure: 'detailed' }),
      create: oc.input(createRegionPackSchema).output(z.object({ regionPack: regionPackSchema })).route({ method: 'POST', path: '/v1/region-packs' }),
      get: oc.input(z.object({ params: idSchema })).output(regionPackSchema).route({ method: 'GET', path: '/v1/region-packs/{id}', inputStructure: 'detailed' }),
      update: oc.input(z.object({ params: idSchema, body: updateRegionPackSchema })).output(z.object({ regionPack: regionPackSchema })).route({ method: 'PUT', path: '/v1/region-packs/{id}', inputStructure: 'detailed' }),
      delete: oc.input(z.object({ params: idSchema })).output(z.object({ ok: z.boolean() })).route({ method: 'DELETE', path: '/v1/region-packs/{id}', inputStructure: 'detailed' })
    },
    checkProfiles: {
      list: oc.input(listInputSchema).output(checkProfileListResponseSchema).route({ method: 'GET', path: '/v1/check-profiles', inputStructure: 'detailed' }),
      create: oc.input(createCheckProfileSchema).output(z.object({ profile: checkProfileSchema })).route({ method: 'POST', path: '/v1/check-profiles' }),
      get: oc.input(z.object({ params: idSchema })).output(checkProfileSchema).route({ method: 'GET', path: '/v1/check-profiles/{id}', inputStructure: 'detailed' }),
      update: oc.input(z.object({ params: idSchema, body: updateCheckProfileSchema })).output(z.object({ profile: checkProfileSchema })).route({ method: 'PUT', path: '/v1/check-profiles/{id}', inputStructure: 'detailed' }),
      delete: oc.input(z.object({ params: idSchema })).output(z.object({ ok: z.boolean(), deletedRunCount: z.number().int().nonnegative() })).route({ method: 'DELETE', path: '/v1/check-profiles/{id}', inputStructure: 'detailed' }),
      baseline: {
        get: oc.input(z.object({ params: idSchema })).output(checkProfileBaselineResponseSchema).route({ method: 'GET', path: '/v1/check-profiles/{id}/baseline', inputStructure: 'detailed' }),
        set: oc.input(z.object({ params: idSchema, body: setCheckProfileBaselineSchema })).output(checkProfileBaselineResponseSchema).route({ method: 'PUT', path: '/v1/check-profiles/{id}/baseline', inputStructure: 'detailed' }),
        clear: oc.input(z.object({ params: idSchema })).output(checkProfileBaselineResponseSchema).route({ method: 'DELETE', path: '/v1/check-profiles/{id}/baseline', inputStructure: 'detailed' })
      },
      runs: {
        list: oc.input(z.object({ params: idSchema, query: listQuerySchema.optional() })).output(checkProfileRunListResponseSchema).route({ method: 'GET', path: '/v1/check-profiles/{id}/runs', inputStructure: 'detailed' }),
        create: oc.input(z.object({ params: idSchema })).output(checkProfileRunResponseSchema).route({ method: 'POST', path: '/v1/check-profiles/{id}/runs', inputStructure: 'detailed' }),
        get: oc.input(z.object({ params: runParamsSchema })).output(checkProfileRunDetailResponseSchema).route({ method: 'GET', path: '/v1/check-profiles/{id}/runs/{runId}', inputStructure: 'detailed' }),
        compare: oc.input(z.object({ params: runParamsSchema, query: compareQuerySchema })).output(checkProfileComparisonResponseSchema).route({ method: 'GET', path: '/v1/check-profiles/{id}/runs/{runId}/compare', inputStructure: 'detailed' })
      },
      compareLatest: oc.input(z.object({ params: idSchema })).output(checkProfileLatestComparisonResponseSchema).route({ method: 'GET', path: '/v1/check-profiles/{id}/compare/latest', inputStructure: 'detailed' }),
      compareBaseline: oc.input(z.object({ params: idSchema })).output(checkProfileComparisonResponseSchema).route({ method: 'GET', path: '/v1/check-profiles/{id}/compare/baseline', inputStructure: 'detailed' }),
      report: oc.input(z.object({ params: idSchema })).output(checkProfileReportResponseSchema).route({ method: 'GET', path: '/v1/check-profiles/{id}/report', inputStructure: 'detailed' }),
      reportExport: oc
        .input(z.object({
          params: idSchema,
          body: createExportInputSchema.pick({ format: true }).extend({
            source: z.object({
              type: z.literal('check_report'),
              checkId: z.string().min(1)
            }).optional()
          }).optional()
        }))
        .output(exportResourceSchema)
        .route({
          method: 'POST',
          path: '/v1/check-profiles/{id}/report/export',
          inputStructure: 'detailed'
        })
    },
    exports: {
      list: oc.input(listInputSchema).output(exportListResponseSchema).route({ method: 'GET', path: '/v1/exports', inputStructure: 'detailed' }),
      create: oc.input(createExportInputSchema).output(exportResourceSchema).route({ method: 'POST', path: '/v1/exports' }),
      get: oc.input(z.object({ params: z.object({ exportId: z.string().min(1) }) })).output(exportResourceSchema).route({ method: 'GET', path: '/v1/exports/{exportId}', inputStructure: 'detailed' })
    },
    comparisons: {
      list: oc.input(listInputSchema).output(comparisonListResponseSchema).route({ method: 'GET', path: '/v1/comparisons', inputStructure: 'detailed' })
    },
    analyses: {
      list: oc.input(listInputSchema).output(analysisListResponseSchema).route({ method: 'GET', path: '/v1/analyses', inputStructure: 'detailed' })
    }
  })
);

export type AppContract = typeof appContract;
