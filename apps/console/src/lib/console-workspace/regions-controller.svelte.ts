import type { RegionAvailability } from '@webperf/contracts';
import { groupRegions } from './formatters';

type RegionsAccessors = {
  getRegions: () => RegionAvailability[];
  getSelectedRegions: () => string[];
  toggleRegion: (region: RegionAvailability) => void;
};

export class RegionsController {
  constructor(private readonly accessors: RegionsAccessors) {}

  get regions() {
    return this.accessors.getRegions();
  }

  get selectedRegions() {
    return this.accessors.getSelectedRegions();
  }

  get groupedRegions() {
    return groupRegions(this.regions);
  }

  get selectableCount() {
    return this.regions.filter((region) => region.selectable).length;
  }

  toggleRegion = (region: RegionAvailability) => {
    this.accessors.toggleRegion(region);
  };
}

export const createRegionsController = (accessors: RegionsAccessors) =>
  new RegionsController(accessors);
