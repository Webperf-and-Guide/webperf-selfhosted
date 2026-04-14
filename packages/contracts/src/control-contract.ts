import { oc, populateContractRouterPaths, type as orpcType } from '@orpc/contract';
import { z } from 'zod';
import {
  checkProfileBaselineResponseSchema,
  checkProfileComparisonResponseSchema,
  checkProfileLatestComparisonResponseSchema,
  checkProfileListResponseSchema,
  checkProfileReportResponseSchema,
  checkProfileRunDetailResponseSchema,
  checkProfileRunListResponseSchema,
  checkProfileRunResponseSchema,
  checkProfileSchema,
  controlPlaneHealthSchema,
  createCheckProfileSchema,
  createLatencyJobSchema,
  createPropertySchema,
  createRegionPackSchema,
  createRouteSetSchema,
  jobListResponseSchema,
  latencyJobDetailSchema,
  propertyListResponseSchema,
  propertySchema,
  regionPackListResponseSchema,
  regionPackSchema,
  regionsResponseSchema,
  routeSetListResponseSchema,
  routeSetSchema,
  schedulerDispatchResponseSchema,
  setCheckProfileBaselineSchema,
  updateCheckProfileSchema,
  updatePropertySchema,
  updateRegionPackSchema,
  updateRouteSetSchema
} from './public-api';

const idSchema = z.object({
  id: z.string().min(1)
});

const jobIdSchema = z.object({
  jobId: z.string().min(1)
});

const profileRunIdSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1)
});

const runComparisonQuerySchema = profileRunIdSchema.extend({
  against: z.enum(['baseline', 'previous', 'custom']).optional(),
  againstRunId: z.string().min(1).optional()
});

const schedulerDispatchInputSchema = z.object({
  now: z.string().datetime().nullable().optional()
});

const withIdParams = () =>
  z.object({
    params: idSchema
  });

const withJobIdParams = () =>
  z.object({
    params: jobIdSchema
  });

const withPropertyUpdate = () =>
  z.object({
    params: idSchema,
    body: updatePropertySchema
  });

const withRouteSetUpdate = () =>
  z.object({
    params: idSchema,
    body: updateRouteSetSchema
  });

const withRegionPackUpdate = () =>
  z.object({
    params: idSchema,
    body: updateRegionPackSchema
  });

const withCheckProfileUpdate = () =>
  z.object({
    params: idSchema,
    body: updateCheckProfileSchema
  });

const withBaselineSet = () =>
  z.object({
    params: idSchema,
    body: setCheckProfileBaselineSchema
  });

const withProfileRunParams = () =>
  z.object({
    params: profileRunIdSchema
  });

const withRunCompare = () =>
  z.object({
    params: profileRunIdSchema,
    query: z.object({
      against: z.enum(['baseline', 'previous', 'custom']).optional(),
      againstRunId: z.string().min(1).optional()
    })
  });

const createJobResponseSchema = z.object({
  job: latencyJobDetailSchema
});

const propertyMutationResponseSchema = z.object({
  property: propertySchema
});

const routeSetMutationResponseSchema = z.object({
  routeSet: routeSetSchema
});

const regionPackMutationResponseSchema = z.object({
  regionPack: regionPackSchema
});

const checkProfileMutationResponseSchema = z.object({
  profile: checkProfileSchema
});

const deleteResponseSchema = z.object({
  ok: z.boolean()
});

const deleteCheckProfileResponseSchema = z.object({
  ok: z.boolean(),
  deletedRunCount: z.number().int().nonnegative()
});

const selfHostedControlHealthSchema = z.object({
  service: z.string().min(1),
  ok: z.boolean(),
  activeRegions: z.array(z.string().min(1)),
  configuredProbeRegions: z.array(z.string().min(1)),
  maxTargetAttempts: z.number().int().positive(),
  storage: z.object({
    kind: z.literal('sqlite'),
    databasePath: z.string().min(1),
    retainedDays: z.number().int().positive(),
    persistedJobs: z.number().int().nonnegative()
  }),
  savedConfigs: z.object({
    properties: z.number().int().nonnegative(),
    routeSets: z.number().int().nonnegative(),
    regionPacks: z.number().int().nonnegative(),
    checkProfiles: z.number().int().nonnegative(),
    scheduledProfiles: z.number().int().nonnegative()
  }),
  monitoring: z.object({
    profilesWithAlerts: z.number().int().nonnegative(),
    profilesWithThresholds: z.number().int().nonnegative()
  })
});

export const controlHealthSchema = z.union([controlPlaneHealthSchema, selfHostedControlHealthSchema]);

export const CONTROL_OPENAPI_TAG_DEFINITIONS = [
  { name: 'system', description: 'Health, region catalog, and scheduler surfaces.' },
  { name: 'jobs', description: 'Manual checks and run snapshots.' },
  { name: 'properties', description: 'Managed property configuration.' },
  { name: 'routeSets', description: 'Representative route collections.' },
  { name: 'regionPacks', description: 'Named region groupings.' },
  { name: 'checkProfiles', description: 'Saved checks, runs, baselines, and reports.' }
] as const;

export const controlContract = populateContractRouterPaths(
  oc.router({
    health: oc
      .input(orpcType<void>())
      .output(controlHealthSchema)
      .route({
        method: 'GET',
        path: '/v1/health',
        summary: 'Control plane health',
        tags: ['system']
      }),
    regions: oc
      .input(orpcType<void>())
      .output(regionsResponseSchema)
      .route({
        method: 'GET',
        path: '/v1/regions',
        summary: 'List regions',
        tags: ['system']
      }),
    jobs: oc.router({
      list: oc
        .input(orpcType<void>())
        .output(jobListResponseSchema)
        .route({
          method: 'GET',
          path: '/v1/jobs',
          summary: 'List jobs',
          tags: ['jobs']
        }),
      create: oc
        .input(createLatencyJobSchema)
        .output(createJobResponseSchema)
        .route({
          method: 'POST',
          path: '/v1/jobs',
          summary: 'Create job',
          tags: ['jobs']
        }),
      get: oc
        .input(withJobIdParams())
        .output(latencyJobDetailSchema)
        .route({
          method: 'GET',
          path: '/v1/jobs/{jobId}',
          inputStructure: 'detailed',
          summary: 'Get job',
          tags: ['jobs']
        })
    }),
    properties: oc.router({
      list: oc.input(orpcType<void>()).output(propertyListResponseSchema).route({
        method: 'GET',
        path: '/v1/properties',
        summary: 'List properties',
        tags: ['properties']
      }),
      create: oc.input(createPropertySchema).output(propertyMutationResponseSchema).route({
        method: 'POST',
        path: '/v1/properties',
        summary: 'Create property',
        tags: ['properties']
      }),
      get: oc.input(withIdParams()).output(propertySchema).route({
        inputStructure: 'detailed',
        method: 'GET',
        path: '/v1/properties/{id}',
        summary: 'Get property',
        tags: ['properties']
      }),
      update: oc.input(withPropertyUpdate()).output(propertyMutationResponseSchema).route({
        method: 'PUT',
        path: '/v1/properties/{id}',
        inputStructure: 'detailed',
        summary: 'Update property',
        tags: ['properties']
      }),
      delete: oc.input(withIdParams()).output(deleteResponseSchema).route({
        method: 'DELETE',
        path: '/v1/properties/{id}',
        inputStructure: 'detailed',
        summary: 'Delete property',
        tags: ['properties']
      })
    }),
    routeSets: oc.router({
      list: oc.input(orpcType<void>()).output(routeSetListResponseSchema).route({
        method: 'GET',
        path: '/v1/route-sets',
        summary: 'List route sets',
        tags: ['routeSets']
      }),
      create: oc.input(createRouteSetSchema).output(routeSetMutationResponseSchema).route({
        method: 'POST',
        path: '/v1/route-sets',
        summary: 'Create route set',
        tags: ['routeSets']
      }),
      get: oc.input(withIdParams()).output(routeSetSchema).route({
        method: 'GET',
        path: '/v1/route-sets/{id}',
        inputStructure: 'detailed',
        summary: 'Get route set',
        tags: ['routeSets']
      }),
      update: oc.input(withRouteSetUpdate()).output(routeSetMutationResponseSchema).route({
        method: 'PUT',
        path: '/v1/route-sets/{id}',
        inputStructure: 'detailed',
        summary: 'Update route set',
        tags: ['routeSets']
      }),
      delete: oc.input(withIdParams()).output(deleteResponseSchema).route({
        method: 'DELETE',
        path: '/v1/route-sets/{id}',
        inputStructure: 'detailed',
        summary: 'Delete route set',
        tags: ['routeSets']
      })
    }),
    regionPacks: oc.router({
      list: oc.input(orpcType<void>()).output(regionPackListResponseSchema).route({
        method: 'GET',
        path: '/v1/region-packs',
        summary: 'List region packs',
        tags: ['regionPacks']
      }),
      create: oc.input(createRegionPackSchema).output(regionPackMutationResponseSchema).route({
        method: 'POST',
        path: '/v1/region-packs',
        summary: 'Create region pack',
        tags: ['regionPacks']
      }),
      get: oc.input(withIdParams()).output(regionPackSchema).route({
        method: 'GET',
        path: '/v1/region-packs/{id}',
        inputStructure: 'detailed',
        summary: 'Get region pack',
        tags: ['regionPacks']
      }),
      update: oc.input(withRegionPackUpdate()).output(regionPackMutationResponseSchema).route({
        method: 'PUT',
        path: '/v1/region-packs/{id}',
        inputStructure: 'detailed',
        summary: 'Update region pack',
        tags: ['regionPacks']
      }),
      delete: oc.input(withIdParams()).output(deleteResponseSchema).route({
        method: 'DELETE',
        path: '/v1/region-packs/{id}',
        inputStructure: 'detailed',
        summary: 'Delete region pack',
        tags: ['regionPacks']
      })
    }),
    checkProfiles: oc.router({
      list: oc.input(orpcType<void>()).output(checkProfileListResponseSchema).route({
        method: 'GET',
        path: '/v1/check-profiles',
        summary: 'List check profiles',
        tags: ['checkProfiles']
      }),
      create: oc.input(createCheckProfileSchema).output(checkProfileMutationResponseSchema).route({
        method: 'POST',
        path: '/v1/check-profiles',
        summary: 'Create check profile',
        tags: ['checkProfiles']
      }),
      get: oc.input(withIdParams()).output(checkProfileSchema).route({
        method: 'GET',
        path: '/v1/check-profiles/{id}',
        inputStructure: 'detailed',
        summary: 'Get check profile',
        tags: ['checkProfiles']
      }),
      update: oc.input(withCheckProfileUpdate()).output(checkProfileMutationResponseSchema).route({
        method: 'PUT',
        path: '/v1/check-profiles/{id}',
        inputStructure: 'detailed',
        summary: 'Update check profile',
        tags: ['checkProfiles']
      }),
      delete: oc.input(withIdParams()).output(deleteCheckProfileResponseSchema).route({
        method: 'DELETE',
        path: '/v1/check-profiles/{id}',
        inputStructure: 'detailed',
        summary: 'Delete check profile',
        tags: ['checkProfiles']
      }),
      baseline: oc.router({
        get: oc.input(withIdParams()).output(checkProfileBaselineResponseSchema).route({
          method: 'GET',
          path: '/v1/check-profiles/{id}/baseline',
          inputStructure: 'detailed',
          summary: 'Get baseline',
          tags: ['checkProfiles']
        }),
        set: oc.input(withBaselineSet()).output(checkProfileBaselineResponseSchema).route({
          method: 'PUT',
          path: '/v1/check-profiles/{id}/baseline',
          inputStructure: 'detailed',
          summary: 'Set baseline',
          tags: ['checkProfiles']
        }),
        clear: oc.input(withIdParams()).output(checkProfileBaselineResponseSchema).route({
          method: 'DELETE',
          path: '/v1/check-profiles/{id}/baseline',
          inputStructure: 'detailed',
          summary: 'Clear baseline',
          tags: ['checkProfiles']
        })
      }),
      runs: oc.router({
        list: oc.input(withIdParams()).output(checkProfileRunListResponseSchema).route({
          method: 'GET',
          path: '/v1/check-profiles/{id}/runs',
          inputStructure: 'detailed',
          summary: 'List check profile runs',
          tags: ['checkProfiles']
        }),
        create: oc.input(withIdParams()).output(checkProfileRunResponseSchema).route({
          method: 'POST',
          path: '/v1/check-profiles/{id}/runs',
          inputStructure: 'detailed',
          summary: 'Run check profile',
          tags: ['checkProfiles']
        }),
        get: oc.input(withProfileRunParams()).output(checkProfileRunDetailResponseSchema).route({
          method: 'GET',
          path: '/v1/check-profiles/{id}/runs/{runId}',
          inputStructure: 'detailed',
          summary: 'Get check profile run',
          tags: ['checkProfiles']
        }),
        compare: oc.input(withRunCompare()).output(checkProfileComparisonResponseSchema).route({
          method: 'GET',
          path: '/v1/check-profiles/{id}/runs/{runId}/compare',
          inputStructure: 'detailed',
          summary: 'Compare check profile run',
          tags: ['checkProfiles']
        })
      }),
      compareLatest: oc.input(withIdParams()).output(checkProfileLatestComparisonResponseSchema).route({
        method: 'GET',
        path: '/v1/check-profiles/{id}/compare/latest',
        inputStructure: 'detailed',
        summary: 'Compare latest run with previous',
        tags: ['checkProfiles']
      }),
      compareBaseline: oc.input(withIdParams()).output(checkProfileComparisonResponseSchema).route({
        method: 'GET',
        path: '/v1/check-profiles/{id}/compare/baseline',
        inputStructure: 'detailed',
        summary: 'Compare latest run with baseline',
        tags: ['checkProfiles']
      }),
      report: oc.input(withIdParams()).output(checkProfileReportResponseSchema).route({
        method: 'GET',
        path: '/v1/check-profiles/{id}/report',
        inputStructure: 'detailed',
        summary: 'Get check profile report',
        tags: ['checkProfiles']
      })
    }),
    scheduler: oc.router({
      dispatch: oc.input(schedulerDispatchInputSchema).output(schedulerDispatchResponseSchema).route({
        method: 'POST',
        path: '/v1/scheduler/dispatch',
        summary: 'Dispatch scheduled profiles',
        tags: ['system']
      })
    })
  })
);

export type ControlContract = typeof controlContract;
