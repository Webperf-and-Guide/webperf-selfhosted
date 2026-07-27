import type { RuntimeLocationReport } from '@webperf/contracts';

type RegionsAccessors = {
  getRuntimeLocation: () => RuntimeLocationReport;
};

export class RegionsController {
  constructor(private readonly accessors: RegionsAccessors) {}

  get runtimeLocation() {
    return this.accessors.getRuntimeLocation();
  }

  get regionId() {
    return this.runtimeLocation.regionId;
  }

  get regionLabel() {
    return this.runtimeLocation.label ?? this.runtimeLocation.regionId;
  }
}

export const createRegionsController = (accessors: RegionsAccessors) =>
  new RegionsController(accessors);
