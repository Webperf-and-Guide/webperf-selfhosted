import type { Property, RegionAvailability, RegionPack, RouteSet } from '@webperf/contracts';
import type { MetricGridItem, ResourceWorkflowItem } from '@webperf/ui/components/operator/types';
import {
  MAX_SELECTABLE_REGIONS,
  parseRouteEntries
} from './formatters';

type ResourceAccessors = {
  getProperties: () => Property[];
  getRouteSets: () => RouteSet[];
  getRegionPacks: () => RegionPack[];
  getActiveRegionOptions: () => RegionAvailability[];
  refreshControlData: () => Promise<void>;
};

export class ResourcesController {
  readonly maxSelectableRegions = MAX_SELECTABLE_REGIONS;

  state = $state({
    propertyName: '',
    propertyBaseUrl: '',
    editingPropertyId: '',
    routeSetPropertyId: '',
    routeSetName: '',
    routeSetRoutesText: '',
    editingRouteSetId: '',
    regionPackName: '',
    regionPackCodes: [] as string[],
    editingRegionPackId: '',
    resourceEditorTab: 'site' as 'site' | 'route-group' | 'region-set',
    configActionMessage: null as string | null,
    configActionError: null as string | null,
    savingConfigKind: null as string | null
  });

  constructor(private readonly accessors: ResourceAccessors) {}

  get properties() {
    return this.accessors.getProperties();
  }

  get routeSets() {
    return this.accessors.getRouteSets();
  }

  get regionPacks() {
    return this.accessors.getRegionPacks();
  }

  get propertyById() {
    return new Map(this.properties.map((property) => [property.id, property] as const));
  }

  get activeRegionOptions() {
    return this.accessors.getActiveRegionOptions();
  }

  get activeRegionCodeSuggestions() {
    return this.activeRegionOptions.map((region) => region.code);
  }

  get workflowItems(): ResourceWorkflowItem[] {
    return [
      {
        id: 'site',
        label: '1. Site',
        title: 'Define the deployment root',
        detail: 'Store the base URL once so route groups and checks can reference it.'
      },
      {
        id: 'route-group',
        label: '2. Route group',
        title: 'Bundle the release-critical URLs',
        detail: 'Keep homepage, pricing, auth, or SEO-sensitive routes together.'
      },
      {
        id: 'region-set',
        label: '3. Region set',
        title: 'Choose the active corridor',
        detail: 'Pin the launch regions you want each reusable check to cover.'
      }
    ];
  }

  get inventoryItems(): MetricGridItem[] {
    return [
      {
        id: 'sites',
        label: 'Sites',
        value: this.properties.length,
        detail: 'Deployment roots stored for reuse.'
      },
      {
        id: 'route-groups',
        label: 'Route groups',
        value: this.routeSets.length,
        detail: 'Reusable URL bundles for release-critical flows.'
      },
      {
        id: 'region-sets',
        label: 'Region sets',
        value: this.regionPacks.length,
        detail: 'Active corridors ready to be assigned to checks.'
      }
    ];
  }

  isConfigBusy = (prefix: string) => this.state.savingConfigKind?.startsWith(prefix) ?? false;

  resetPropertyForm = () => {
    this.state.editingPropertyId = '';
    this.state.propertyName = '';
    this.state.propertyBaseUrl = '';
  };

  resetRouteSetForm = () => {
    this.state.editingRouteSetId = '';
    this.state.routeSetPropertyId = '';
    this.state.routeSetName = '';
    this.state.routeSetRoutesText = '';
  };

  resetRegionPackForm = () => {
    this.state.editingRegionPackId = '';
    this.state.regionPackName = '';
    this.state.regionPackCodes = [];
  };

  loadPropertyEditor = (propertyId: string) => {
    if (!propertyId) {
      this.resetPropertyForm();
      return;
    }

    const property = this.propertyById.get(propertyId);

    if (!property) {
      return;
    }

    this.state.editingPropertyId = property.id;
    this.state.propertyName = property.name;
    this.state.propertyBaseUrl = property.baseUrl;
  };

  loadRouteSetEditor = (routeSetId: string) => {
    if (!routeSetId) {
      this.resetRouteSetForm();
      return;
    }

    const routeSet = this.routeSets.find((entry) => entry.id === routeSetId);

    if (!routeSet) {
      return;
    }

    this.state.editingRouteSetId = routeSet.id;
    this.state.routeSetPropertyId = routeSet.propertyId;
    this.state.routeSetName = routeSet.name;
    this.state.routeSetRoutesText = routeSet.routes.map((route) => `${route.label} | ${route.url}`).join('\n');
  };

  loadRegionPackEditor = (regionPackId: string) => {
    if (!regionPackId) {
      this.resetRegionPackForm();
      return;
    }

    const regionPack = this.regionPacks.find((entry) => entry.id === regionPackId);

    if (!regionPack) {
      return;
    }

    this.state.editingRegionPackId = regionPack.id;
    this.state.regionPackName = regionPack.name;
    this.state.regionPackCodes = [...regionPack.regions];
  };

  submitProperty = async (event: SubmitEvent) => {
    event.preventDefault();
    await this.submitConfig('property', this.state.editingPropertyId ? 'update' : 'create', async () => {
      const response = await fetch(
        this.state.editingPropertyId
          ? `/api/control/properties/${this.state.editingPropertyId}`
          : '/api/control/properties',
        {
          method: this.state.editingPropertyId ? 'PUT' : 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            name: this.state.propertyName,
            baseUrl: this.state.propertyBaseUrl
          })
        }
      );

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(
          payload.error ?? `Failed to ${this.state.editingPropertyId ? 'update' : 'create'} site.`
        );
      }

      const actionLabel = this.state.editingPropertyId ? 'updated' : 'created';
      this.resetPropertyForm();
      return `Property ${actionLabel}.`;
    });
  };

  submitRouteSet = async (event: SubmitEvent) => {
    event.preventDefault();
    await this.submitConfig('route-set', this.state.editingRouteSetId ? 'update' : 'create', async () => {
      const routes = parseRouteEntries(this.state.routeSetRoutesText);
      const response = await fetch(
        this.state.editingRouteSetId
          ? `/api/control/route-sets/${this.state.editingRouteSetId}`
          : '/api/control/route-sets',
        {
          method: this.state.editingRouteSetId ? 'PUT' : 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            propertyId: this.state.routeSetPropertyId,
            name: this.state.routeSetName,
            routes
          })
        }
      );

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(
          payload.error ?? `Failed to ${this.state.editingRouteSetId ? 'update' : 'create'} route group.`
        );
      }

      const actionLabel = this.state.editingRouteSetId ? 'updated' : 'created';
      this.resetRouteSetForm();
      return `Route set ${actionLabel}.`;
    });
  };

  submitRegionPack = async (event: SubmitEvent) => {
    event.preventDefault();
    await this.submitConfig('region-pack', this.state.editingRegionPackId ? 'update' : 'create', async () => {
      const response = await fetch(
        this.state.editingRegionPackId
          ? `/api/control/region-packs/${this.state.editingRegionPackId}`
          : '/api/control/region-packs',
        {
          method: this.state.editingRegionPackId ? 'PUT' : 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            name: this.state.regionPackName,
            regions: this.state.regionPackCodes
          })
        }
      );

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(
          payload.error ?? `Failed to ${this.state.editingRegionPackId ? 'update' : 'create'} region set.`
        );
      }

      const actionLabel = this.state.editingRegionPackId ? 'updated' : 'created';
      this.resetRegionPackForm();
      return `Region pack ${actionLabel}.`;
    });
  };

  deleteProperty = async (propertyId: string) => {
    if (!confirm('Delete this site? Route groups and saved checks must already be removed.')) {
      return;
    }

    await this.submitConfig('property', 'delete', async () => {
      const response = await fetch(`/api/control/properties/${propertyId}`, {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json'
        }
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Failed to delete site.');
      }

      this.resetPropertyForm();
      return 'Property deleted.';
    });
  };

  deleteRouteSet = async (routeSetId: string) => {
    if (!confirm('Delete this route group? Saved checks that use it must already be removed or reassigned.')) {
      return;
    }

    await this.submitConfig('route-set', 'delete', async () => {
      const response = await fetch(`/api/control/route-sets/${routeSetId}`, {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json'
        }
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Failed to delete route group.');
      }

      this.resetRouteSetForm();
      return 'Route set deleted.';
    });
  };

  deleteRegionPack = async (regionPackId: string) => {
    if (!confirm('Delete this region set? Saved checks that use it must already be removed or reassigned.')) {
      return;
    }

    await this.submitConfig('region-pack', 'delete', async () => {
      const response = await fetch(`/api/control/region-packs/${regionPackId}`, {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json'
        }
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Failed to delete region set.');
      }

      this.resetRegionPackForm();
      return 'Region pack deleted.';
    });
  };

  toggleRegionPackCode = (code: string) => {
    if (this.state.regionPackCodes.includes(code)) {
      this.state.regionPackCodes = this.state.regionPackCodes.filter((value) => value !== code);
      return;
    }

    if (this.state.regionPackCodes.length >= this.maxSelectableRegions) {
      this.state.configActionError = `A region set can include up to ${this.maxSelectableRegions} active regions right now.`;
      return;
    }

    this.state.configActionError = null;
    this.state.regionPackCodes = [...this.state.regionPackCodes, code];
  };

  private submitConfig = async (
    kind: string,
    actionName: 'create' | 'update' | 'delete',
    action: () => Promise<string>
  ) => {
    this.state.savingConfigKind = `${kind}:${actionName}`;
    this.state.configActionError = null;
    this.state.configActionMessage = null;

    try {
      const message = await action();
      this.state.configActionMessage = message;
      await this.accessors.refreshControlData();
    } catch (error) {
      this.state.configActionError =
        error instanceof Error ? error.message : `Failed to ${actionName} ${kind.replace('-', ' ')}.`;
    } finally {
      this.state.savingConfigKind = null;
    }
  };
}

export const createResourcesController = (accessors: ResourceAccessors) =>
  new ResourcesController(accessors);
