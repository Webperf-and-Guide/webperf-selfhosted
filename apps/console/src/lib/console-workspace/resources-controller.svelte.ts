import type { Property, RouteSet } from '@webperf/contracts';
import type { MetricGridItem, ResourceWorkflowItem } from '@webperf/ui/components/operator/types';
import { parseRouteEntries } from './formatters';

type ResourceAccessors = {
  getProperties: () => Property[];
  getRouteSets: () => RouteSet[];
  refreshControlData: () => Promise<void>;
};

export class ResourcesController {
  state = $state({
    propertyName: '',
    propertyBaseUrl: '',
    editingPropertyId: '',
    routeSetPropertyId: '',
    routeSetName: '',
    routeSetRoutesText: '',
    editingRouteSetId: '',
    // Phase 1 of issue #14: the region-set editor was removed. One
    // standalone deployment measures from one runtime location, so the
    // resources workflow is now Site -> Route group only.
    resourceEditorTab: 'site' as 'site' | 'route-group',
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

  get propertyById() {
    return new Map(this.properties.map((property) => [property.id, property] as const));
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
