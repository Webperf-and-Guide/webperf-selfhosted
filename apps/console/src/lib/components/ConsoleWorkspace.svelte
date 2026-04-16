<script lang="ts">
  import { browser } from '$app/environment';
  import { invalidateAll } from '$app/navigation';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import DerivedResourceBrowser from '$lib/components/DerivedResourceBrowser.svelte';
  import LiveRunResults from '$lib/components/workspace/LiveRunResults.svelte';
  import LiveRunTargetCard from '$lib/components/workspace/LiveRunTargetCard.svelte';
  import ManualRunPanel from '$lib/components/workspace/ManualRunPanel.svelte';
  import RegionCatalog from '$lib/components/workspace/RegionCatalog.svelte';
  import RegionContinentCard from '$lib/components/workspace/RegionContinentCard.svelte';
  import ReportsWorkspace from '$lib/components/workspace/ReportsWorkspace.svelte';
  import ResourceEditors from '$lib/components/workspace/ResourceEditors.svelte';
  import SavedCheckCard from '$lib/components/workspace/SavedCheckCard.svelte';
  import SavedChecksWorkspace from '$lib/components/workspace/SavedChecksWorkspace.svelte';
  import WorkspaceMap from '$lib/components/workspace/WorkspaceMap.svelte';
  import { fetchControlJson } from '$lib/client/control-query';
  import Button from '@webperf/ui/components/ui/button';
  import { Card } from '@webperf/ui/components/ui/card';
  import { Checkbox } from '@webperf/ui/components/ui/checkbox';
  import { CopyButton } from '@webperf/ui/components/ui/copy-button';
  import {
    Root as FieldSet,
    Content as FieldSetContent,
    Footer as FieldSetFooter,
    Title as FieldSetTitle
  } from '@webperf/ui/components/ui/field-set';
  import { Input } from '@webperf/ui/components/ui/input';
  import {
    NumberField,
    NumberFieldDecrement,
    NumberFieldGroup,
    NumberFieldIncrement,
    NumberFieldInput
  } from '@webperf/ui/components/ui/number-field';
  import { ScrollArea } from '@webperf/ui/components/ui/scroll-area';
  import { Select } from '@webperf/ui/components/ui/select';
  import { Switch } from '@webperf/ui/components/ui/switch';
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
  } from '@webperf/ui/components/ui/table';
  import { TagsInput } from '@webperf/ui/components/ui/tags-input';
  import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger
  } from '@webperf/ui/components/ui/tabs';
  import { Textarea } from '@webperf/ui/components/ui/textarea';
  import {
    UnderlineTabs,
    UnderlineTabsContent,
    UnderlineTabsList,
    UnderlineTabsTrigger
  } from '@webperf/ui/components/ui/underline-tabs';
  import type {
    CheckProfile,
    CheckProfileListResponse,
    CheckProfileComparisonResponse,
    CheckProfileLatestComparisonResponse,
    CheckProfileReportResponse,
    CheckProfileRunDetailResponse,
    Property,
    RegionAvailability,
    RegionPack,
    RouteSet,
    LatencyJobDetail,
    RequestHeader
  } from '@webperf/contracts';
  import { onDestroy } from 'svelte';
  import type { ConsolePageData, ConsoleWorkspaceMode } from '$lib/console-data';
  import type { ComparisonSection } from '$lib/console-view';

  let { data, mode = 'overview' } = $props<{
    data: ConsolePageData;
    mode?: ConsoleWorkspaceMode;
  }>();
  type SavedChecksData = NonNullable<ConsolePageData['savedChecks']>;
  type SavedProfileMeta = SavedChecksData['profileMeta'][number];
  const queryClient = useQueryClient();

  const maxSelectableRegions = 4;
  const regions = $derived.by(() => data.regions ?? []);
  const turnstileSiteKey = $derived.by(() => data.turnstileSiteKey ?? null);
  const savedChecks = $derived.by(() => data.savedChecks ?? null);
  const properties = $derived.by(() => savedChecks?.properties ?? []);
  const routeSets = $derived.by(() => savedChecks?.routeSets ?? []);
  const regionPacks = $derived.by(() => savedChecks?.regionPacks ?? []);
  const checkProfiles = $derived.by(() => savedChecks?.checkProfiles ?? []);
  const profileMetaEntries = $derived.by(() => savedChecks?.profileMeta ?? []);
  const groupedRegions = $derived.by(() => groupRegions(regions));
  const selectableCount = $derived.by(
    () => regions.filter((region: RegionAvailability) => region.selectable).length
  );
  const defaultSelectedRegions = $derived.by(() =>
    regions
      .filter((region: RegionAvailability) => region.defaultSelected)
      .map((region: RegionAvailability) => region.code)
  );
  const propertyById = $derived.by(
    () => new Map<string, Property>(properties.map((property: Property) => [property.id, property] as const))
  );
  const routeSetById = $derived.by(
    () => new Map<string, RouteSet>(routeSets.map((routeSet: RouteSet) => [routeSet.id, routeSet] as const))
  );
  const regionPackById = $derived.by(
    () =>
      new Map<string, RegionPack>(regionPacks.map((regionPack: RegionPack) => [regionPack.id, regionPack] as const))
  );
  const checkProfileById = $derived.by(
    () => new Map<string, CheckProfile>(checkProfiles.map((profile: CheckProfile) => [profile.id, profile] as const))
  );
  const profileMetaById = $derived.by(
    () =>
      new Map<string, SavedProfileMeta>(
        profileMetaEntries.map((entry: SavedProfileMeta) => [entry.profileId, entry] as const)
      )
  );
  const scheduledCheckCount = $derived.by(
    () => checkProfiles.filter((profile: CheckProfile) => Boolean(profile.schedule?.intervalMinutes)).length
  );
  const pinnedBaselineCount = $derived.by(
    () => checkProfiles.filter((profile: CheckProfile) => Boolean(profile.baseline?.runId)).length
  );
  const totalRecordedRuns = $derived.by(
    () => profileMetaEntries.reduce((total: number, entry: SavedProfileMeta) => total + entry.runs.length, 0)
  );
  const showOverview = $derived(mode === 'overview');
  const showResources = $derived(mode === 'resources');
  const showChecks = $derived(mode === 'checks');
  const showReports = $derived(mode === 'reports');
  const showRegions = $derived(mode === 'regions');

  let targetUrl = $state('');
  let note = $state('');
  let requestMethod = $state('GET');
  let requestHeadersText = $state('');
  let requestBody = $state('');
  let requestContentType = $state('');
  let jobMonitorType = $state<'latency' | 'uptime'>('latency');
  let jobLatencyThresholdMs = $state('');
  let userSelectedRegions = $state<string[] | null>(null);
  const selectedRegions = $derived.by(() => userSelectedRegions ?? defaultSelectedRegions);
  let isSubmitting = $state(false);
  let submitError = $state<string | null>(null);
  let helperMessage = $state<string | null>(null);
  let job = $state<LatencyJobDetail | null>(null);
  let streamState = $state<'idle' | 'streaming' | 'done'>('idle');
  let configActionMessage = $state<string | null>(null);
  let configActionError = $state<string | null>(null);
  let savingConfigKind = $state<string | null>(null);
  let runningProfileId = $state<string | null>(null);
  let profileActionMessage = $state<string | null>(null);
  let profileActionError = $state<string | null>(null);
  let baselineActionProfileId = $state<string | null>(null);
  let eventSource: EventSource | null = null;
  let resourceEditorTab = $state<'site' | 'route-group' | 'region-set'>('site');
  let reportWorkspaceTab = $state<'browser' | 'endpoints'>('browser');
  let checkProfileFilterDraft = $state('');
  let checkProfileFilter = $state('');
  let checkProfilePageSize = $state(6);
  let checkProfilePageToken = $state<string | null>(null);
  let checkProfilePreviousTokens = $state<string[]>([]);

  const emptyCheckProfilePageInfo = () => ({
    pageSize: checkProfilePageSize,
    totalCount: checkProfiles.length,
    nextPageToken: null,
    filter: null
  });

  const buildInitialCheckProfilePage = (): CheckProfileListResponse => {
    const initialProfiles = checkProfiles.slice(0, checkProfilePageSize);
    return {
      checkProfiles: initialProfiles,
      pageInfo: {
        pageSize: checkProfilePageSize,
        totalCount: checkProfiles.length,
        nextPageToken: checkProfiles.length > initialProfiles.length ? String(initialProfiles.length) : null,
        filter: null
      }
    };
  };

  const checkProfileListQuery = createQuery(() => ({
    queryKey: ['control', 'check-profiles', checkProfileFilter, checkProfilePageSize, checkProfilePageToken],
    enabled: browser && Boolean(savedChecks),
    initialData: buildInitialCheckProfilePage(),
    queryFn: async () =>
      fetchControlJson<CheckProfileListResponse>('check-profiles', {
        pageSize: checkProfilePageSize,
        pageToken: checkProfilePageToken,
        filter: checkProfileFilter || null
      })
  }));

  const visibleCheckProfiles = $derived.by<CheckProfile[]>(() => checkProfileListQuery.data?.checkProfiles ?? []);
  const checkProfilePageInfo = $derived.by(() =>
    checkProfileListQuery.data?.pageInfo ?? emptyCheckProfilePageInfo()
  );

  let propertyName = $state('');
  let propertyBaseUrl = $state('');
  let editingPropertyId = $state('');
  let routeSetPropertyId = $state('');
  let routeSetName = $state('');
  let routeSetRoutesText = $state('');
  let editingRouteSetId = $state('');
  let regionPackName = $state('');
  let regionPackCodes = $state<string[]>([]);
  let editingRegionPackId = $state('');
  let profilePropertyId = $state('');
  let profileRouteSetId = $state('');
  let profileRegionPackId = $state('');
  let profileName = $state('');
  let profileNote = $state('');
  let profileScheduleMinutes = $state('');
  let profileRequestMethod = $state('GET');
  let profileRequestHeadersText = $state('');
  let profileRequestBody = $state('');
  let profileRequestContentType = $state('');
  let profileMonitorType = $state<'latency' | 'uptime'>('latency');
  let profileLatencyThresholdMs = $state('');
  let profileAlertEnabled = $state(false);
  let profileAlertOnFailure = $state(true);
  let profileAlertOnThreshold = $state(false);
  let profileAlertOnRegression = $state(false);
  let profileWebhookTargetsText = $state('');
  let editingProfileId = $state('');

  const closeStream = () => {
    eventSource?.close();
    eventSource = null;
  };

  onDestroy(() => {
    closeStream();
  });

  const refreshControlData = async () => {
    await invalidateAll();
    await queryClient.invalidateQueries({ queryKey: ['control'] });
  };

  const resetCheckProfilePaging = () => {
    checkProfilePageToken = null;
    checkProfilePreviousTokens = [];
  };

  const applyCheckProfileFilter = () => {
    checkProfileFilter = checkProfileFilterDraft.trim();
    resetCheckProfilePaging();
  };

  const clearCheckProfileFilter = () => {
    checkProfileFilterDraft = '';
    checkProfileFilter = '';
    resetCheckProfilePaging();
  };

  const goToNextCheckProfilePage = () => {
    if (!checkProfilePageInfo.nextPageToken) {
      return;
    }

    checkProfilePreviousTokens = [...checkProfilePreviousTokens, checkProfilePageToken ?? '0'];
    checkProfilePageToken = checkProfilePageInfo.nextPageToken;
  };

  const goToPreviousCheckProfilePage = () => {
    if (checkProfilePreviousTokens.length === 0) {
      return;
    }

    const nextHistory = [...checkProfilePreviousTokens];
    const previousToken = nextHistory.pop() ?? '0';
    checkProfilePreviousTokens = nextHistory;
    checkProfilePageToken = previousToken === '0' ? null : previousToken;
  };

  const toggleRegion = (region: RegionAvailability) => {
    if (!region.selectable) {
      helperMessage = `${region.label} is cataloged, but not activated yet.`;
      return;
    }

    helperMessage = null;

    if (selectedRegions.includes(region.code)) {
      userSelectedRegions = selectedRegions.filter((code: string) => code !== region.code);
      return;
    }

    if (selectedRegions.length >= maxSelectableRegions) {
      helperMessage = `You can measure up to ${maxSelectableRegions} regions per run.`;
      return;
    }

    userSelectedRegions = [...selectedRegions, region.code];
  };

  const submitJob = async (event: SubmitEvent) => {
    event.preventDefault();
    submitError = null;
    helperMessage = null;

    if (!targetUrl) {
      submitError = 'Enter a URL to measure.';
      return;
    }

    if (selectedRegions.length === 0) {
      submitError = 'Choose at least one active region.';
      return;
    }

    isSubmitting = true;

    const form = event.currentTarget as HTMLFormElement;
    const turnstileToken = form.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')?.value;

    try {
      const response = await fetch('/api/control/jobs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          url: targetUrl,
          regions: selectedRegions,
          note: note || undefined,
          request: buildRequestConfig(requestMethod, requestHeadersText, requestBody, requestContentType),
          monitorPolicy: {
            monitorType: jobMonitorType,
            successRule: 'status_2xx_3xx',
            latencyThresholdMs:
              jobMonitorType === 'latency' && jobLatencyThresholdMs ? Number(jobLatencyThresholdMs) : null
          },
          turnstileToken: turnstileToken || undefined
        })
      });

      const payload = (await response.json()) as {
        error?: string;
        job?: LatencyJobDetail;
      };

      if (!response.ok) {
        submitError = payload.error ?? 'Failed to create a latency job.';
        return;
      }

      if (!payload.job) {
        submitError = 'The control plane did not return a job snapshot.';
        return;
      }

      job = payload.job;
      streamState = 'streaming';
      startStream(payload.job.id);
    } catch (error) {
      submitError = error instanceof Error ? error.message : 'Failed to create a latency job.';
    } finally {
      isSubmitting = false;
    }
  };

  const startStream = (jobId: string) => {
    closeStream();
    streamState = 'streaming';

    const nextSource = new EventSource(`/api/control/jobs/${jobId}/stream`);
    eventSource = nextSource;

    nextSource.onmessage = (message) => {
      const payload = JSON.parse(message.data) as { job?: LatencyJobDetail; error?: string };

      if (payload.error) {
        submitError = payload.error;
        streamState = 'done';
        closeStream();
        return;
      }

      if (!payload.job) {
        return;
      }

      job = payload.job;

      if (payload.job.summary.inflight === 0) {
        streamState = 'done';
        closeStream();
      }
    };

    nextSource.onerror = () => {
      closeStream();

      const currentJobId = job?.id;

      if (job && currentJobId && job.summary.inflight > 0) {
        helperMessage = 'Stream reconnected while the control plane keeps working.';
        setTimeout(() => startStream(currentJobId), 1000);
        return;
      }

      streamState = 'done';
    };
  };

  function groupRegions(regions: RegionAvailability[]) {
    const continents = Array.from(new Set(regions.map((region) => region.continent)));

    return continents.map((continent) => ({
      continent,
      regions: regions.filter((region) => region.continent === continent)
    }));
  }

  const formatTiming = (value: number | null | undefined) => (value == null ? 'n/a' : `${value} ms`);
  const formatText = (value: string | null | undefined) => value ?? 'n/a';
  const formatDateTime = (value: string | null | undefined) =>
    value ? new Date(value).toLocaleString() : 'n/a';
  const formatSchedule = (minutes: number | null | undefined) =>
    minutes == null ? 'manual only' : `every ${minutes} min`;
  const getPropertyName = (profile: CheckProfile) => propertyById.get(profile.propertyId)?.name ?? 'Unknown site';
  const getRouteSetName = (profile: CheckProfile) => routeSetById.get(profile.routeSetId)?.name ?? 'Unknown route group';
  const getRegionPackName = (profile: CheckProfile) =>
    regionPackById.get(profile.regionPackId)?.name ?? 'Unknown region set';
  const getProfileMeta = (profileId: string) => profileMetaById.get(profileId) ?? null;
  const getLatestComparison = (profileId: string): CheckProfileLatestComparisonResponse | null =>
    getProfileMeta(profileId)?.latestComparison ?? null;
  const getBaselineComparison = (profileId: string): CheckProfileComparisonResponse | null =>
    getProfileMeta(profileId)?.baselineComparison ?? null;
  const getRecentRuns = (profileId: string) => getProfileMeta(profileId)?.runs ?? [];
  const getRecentRunDetails = (profileId: string) => getProfileMeta(profileId)?.recentRunDetails ?? [];
  const getReport = (profileId: string): CheckProfileReportResponse | null => getProfileMeta(profileId)?.report ?? null;
  const getBaselineRunId = (profile: CheckProfile) => profile.baseline?.runId ?? null;
  const isBaselineRun = (profile: CheckProfile, runId: string) => getBaselineRunId(profile) === runId;
  const activeRegionOptions = $derived.by(() =>
    regions.filter((region: RegionAvailability) => region.selectable)
  );
  const controlModeLabel = $derived.by(() =>
    savedChecks ? 'Persistent self-host mode' : 'Live-check mode'
  );
  const controlModeDetail = $derived.by(() =>
    savedChecks
      ? 'Sites, saved checks, diffs, exports, and scheduler dispatch are available.'
      : 'Manual checks are available while saved resources stay offline.'
  );
  const activeRegionPreview = $derived.by(() => {
    const labels = activeRegionOptions.slice(0, 4).map((region: RegionAvailability) => region.label);
    return labels.length > 0 ? labels.join(' · ') : 'No active regions';
  });
  const activeRegionCodeSuggestions = $derived.by(() =>
    activeRegionOptions.map((region: RegionAvailability) => region.code)
  );
  const isConfigBusy = (prefix: string) => savingConfigKind?.startsWith(prefix) ?? false;

  const resetPropertyForm = () => {
    editingPropertyId = '';
    propertyName = '';
    propertyBaseUrl = '';
  };

  const resetRouteSetForm = () => {
    editingRouteSetId = '';
    routeSetPropertyId = '';
    routeSetName = '';
    routeSetRoutesText = '';
  };

  const resetRegionPackForm = () => {
    editingRegionPackId = '';
    regionPackName = '';
    regionPackCodes = [];
  };

  const resetProfileForm = () => {
    editingProfileId = '';
    profilePropertyId = '';
    profileRouteSetId = '';
    profileRegionPackId = '';
    profileName = '';
    profileNote = '';
    profileScheduleMinutes = '';
    profileRequestMethod = 'GET';
    profileRequestHeadersText = '';
    profileRequestBody = '';
    profileRequestContentType = '';
    profileMonitorType = 'latency';
    profileLatencyThresholdMs = '';
    profileAlertEnabled = false;
    profileAlertOnFailure = true;
    profileAlertOnThreshold = false;
    profileAlertOnRegression = false;
    profileWebhookTargetsText = '';
  };

  const loadPropertyEditor = (propertyId: string) => {
    if (!propertyId) {
      resetPropertyForm();
      return;
    }

    const property = propertyById.get(propertyId);

    if (!property) {
      return;
    }

    editingPropertyId = property.id;
    propertyName = property.name;
    propertyBaseUrl = property.baseUrl;
  };

  const loadRouteSetEditor = (routeSetId: string) => {
    if (!routeSetId) {
      resetRouteSetForm();
      return;
    }

    const routeSet = routeSetById.get(routeSetId);

    if (!routeSet) {
      return;
    }

    editingRouteSetId = routeSet.id;
    routeSetPropertyId = routeSet.propertyId;
    routeSetName = routeSet.name;
    routeSetRoutesText = routeSet.routes.map((route) => `${route.label} | ${route.url}`).join('\n');
  };

  const loadRegionPackEditor = (regionPackId: string) => {
    if (!regionPackId) {
      resetRegionPackForm();
      return;
    }

    const regionPack = regionPackById.get(regionPackId);

    if (!regionPack) {
      return;
    }

    editingRegionPackId = regionPack.id;
    regionPackName = regionPack.name;
    regionPackCodes = [...regionPack.regions];
  };

  const loadProfileEditor = (profileId: string) => {
    if (!profileId) {
      resetProfileForm();
      return;
    }

    const profile = checkProfileById.get(profileId);

    if (!profile) {
      return;
    }

    editingProfileId = profile.id;
    profilePropertyId = profile.propertyId;
    profileRouteSetId = profile.routeSetId;
    profileRegionPackId = profile.regionPackId;
    profileName = profile.name;
    profileNote = profile.note ?? '';
    profileScheduleMinutes = profile.schedule?.intervalMinutes?.toString() ?? '';
    profileRequestMethod = profile.request?.method ?? 'GET';
    profileRequestHeadersText = stringifyHeaders(profile.request?.headers ?? []);
    profileRequestBody = profile.request?.body?.value ?? '';
    profileRequestContentType = profile.request?.body?.contentType ?? '';
    profileMonitorType = profile.monitorPolicy?.monitorType ?? 'latency';
    profileLatencyThresholdMs = profile.monitorPolicy?.latencyThresholdMs?.toString() ?? '';
    profileAlertEnabled = profile.alerts?.enabled ?? false;
    profileAlertOnFailure = profile.alerts?.triggers.onFailure ?? true;
    profileAlertOnThreshold = profile.alerts?.triggers.onLatencyThresholdBreach ?? false;
    profileAlertOnRegression = profile.alerts?.triggers.onRegression ?? false;
    profileWebhookTargetsText = stringifyWebhookTargets(profile.alerts?.webhookTargets ?? []);
  };

  const runCheckProfile = async (profileId: string) => {
    runningProfileId = profileId;
    profileActionError = null;
    profileActionMessage = null;

    try {
      const response = await fetch(`/api/control/check-profiles/${profileId}/runs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: '{}'
      });

      const payload = (await response.json()) as {
        error?: string;
        jobs?: Array<{ id: string }>;
      };

      if (!response.ok) {
        profileActionError = payload.error ?? 'Failed to run the saved check.';
        return;
      }

      profileActionMessage = `Triggered ${payload.jobs?.length ?? 0} route checks for ${profileId}.`;
      await refreshControlData();
    } catch (error) {
      profileActionError = error instanceof Error ? error.message : 'Failed to run the saved check.';
    } finally {
      runningProfileId = null;
    }
  };

  const pinBaseline = async (profileId: string, runId: string) => {
    baselineActionProfileId = profileId;
    profileActionError = null;
    profileActionMessage = null;

    try {
      const response = await fetch(`/api/control/check-profiles/${profileId}/baseline`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          runId
        })
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        profileActionError = payload.error ?? 'Failed to pin baseline.';
        return;
      }

      profileActionMessage = 'Baseline pinned.';
      await refreshControlData();
    } catch (error) {
      profileActionError = error instanceof Error ? error.message : 'Failed to pin baseline.';
    } finally {
      baselineActionProfileId = null;
    }
  };

  const clearBaseline = async (profileId: string) => {
    baselineActionProfileId = profileId;
    profileActionError = null;
    profileActionMessage = null;

    try {
      const response = await fetch(`/api/control/check-profiles/${profileId}/baseline`, {
        method: 'DELETE'
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        profileActionError = payload.error ?? 'Failed to clear baseline.';
        return;
      }

      profileActionMessage = 'Baseline cleared.';
      await refreshControlData();
    } catch (error) {
      profileActionError = error instanceof Error ? error.message : 'Failed to clear baseline.';
    } finally {
      baselineActionProfileId = null;
    }
  };

  const submitProperty = async (event: SubmitEvent) => {
    event.preventDefault();
    await submitConfig('property', editingPropertyId ? 'update' : 'create', async () => {
      const response = await fetch(editingPropertyId ? `/api/control/properties/${editingPropertyId}` : '/api/control/properties', {
        method: editingPropertyId ? 'PUT' : 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: propertyName,
          baseUrl: propertyBaseUrl
        })
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? `Failed to ${editingPropertyId ? 'update' : 'create'} site.`);
      }

      const actionLabel = editingPropertyId ? 'updated' : 'created';
      resetPropertyForm();
      return `Property ${actionLabel}.`;
    });
  };

  const submitRouteSet = async (event: SubmitEvent) => {
    event.preventDefault();
    await submitConfig('route-set', editingRouteSetId ? 'update' : 'create', async () => {
      const routes = parseRouteEntries(routeSetRoutesText);
      const response = await fetch(editingRouteSetId ? `/api/control/route-sets/${editingRouteSetId}` : '/api/control/route-sets', {
        method: editingRouteSetId ? 'PUT' : 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          propertyId: routeSetPropertyId,
          name: routeSetName,
          routes
        })
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? `Failed to ${editingRouteSetId ? 'update' : 'create'} route group.`);
      }

      const actionLabel = editingRouteSetId ? 'updated' : 'created';
      resetRouteSetForm();
      return `Route set ${actionLabel}.`;
    });
  };

  const submitRegionPack = async (event: SubmitEvent) => {
    event.preventDefault();
    await submitConfig('region-pack', editingRegionPackId ? 'update' : 'create', async () => {
      const response = await fetch(
        editingRegionPackId ? `/api/control/region-packs/${editingRegionPackId}` : '/api/control/region-packs',
        {
          method: editingRegionPackId ? 'PUT' : 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            name: regionPackName,
            regions: regionPackCodes
          })
        }
      );

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? `Failed to ${editingRegionPackId ? 'update' : 'create'} region set.`);
      }

      const actionLabel = editingRegionPackId ? 'updated' : 'created';
      resetRegionPackForm();
      return `Region pack ${actionLabel}.`;
    });
  };

  const submitCheckProfile = async (event: SubmitEvent) => {
    event.preventDefault();
    await submitConfig('check-profile', editingProfileId ? 'update' : 'create', async () => {
      const response = await fetch(
        editingProfileId ? `/api/control/check-profiles/${editingProfileId}` : '/api/control/check-profiles',
        {
          method: editingProfileId ? 'PUT' : 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            propertyId: profilePropertyId,
            routeSetId: profileRouteSetId,
            regionPackId: profileRegionPackId,
            name: profileName,
            note: profileNote || undefined,
            request: buildRequestConfig(
              profileRequestMethod,
              profileRequestHeadersText,
              profileRequestBody,
              profileRequestContentType
            ),
            monitorPolicy: {
              monitorType: profileMonitorType,
              successRule: 'status_2xx_3xx',
              latencyThresholdMs:
                profileMonitorType === 'latency' && profileLatencyThresholdMs
                  ? Number(profileLatencyThresholdMs)
                  : null
            },
            alerts: {
              enabled: profileAlertEnabled,
              webhookTargets: parseWebhookTargets(profileWebhookTargetsText),
              triggers: {
                onFailure: profileAlertOnFailure,
                onLatencyThresholdBreach: profileAlertOnThreshold,
                onRegression: profileAlertOnRegression
              }
            },
            scheduleIntervalMinutes: profileScheduleMinutes ? Number(profileScheduleMinutes) : undefined
          })
        }
      );

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? `Failed to ${editingProfileId ? 'update' : 'create'} saved check.`);
      }

      const actionLabel = editingProfileId ? 'updated' : 'created';
      resetProfileForm();
      return `Check profile ${actionLabel}.`;
    });
  };

  const deleteProperty = async (propertyId: string) => {
    if (!confirm('Delete this site? Route groups and saved checks must already be removed.')) {
      return;
    }

    await submitConfig('property', 'delete', async () => {
      const response = await fetch(`/api/control/properties/${propertyId}`, {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json'
        },
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Failed to delete site.');
      }

      resetPropertyForm();
      return 'Property deleted.';
    });
  };

  const deleteRouteSet = async (routeSetId: string) => {
    if (!confirm('Delete this route group? Saved checks that use it must already be removed or reassigned.')) {
      return;
    }

    await submitConfig('route-set', 'delete', async () => {
      const response = await fetch(`/api/control/route-sets/${routeSetId}`, {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json'
        },
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Failed to delete route group.');
      }

      resetRouteSetForm();
      return 'Route set deleted.';
    });
  };

  const deleteRegionPack = async (regionPackId: string) => {
    if (!confirm('Delete this region set? Saved checks that use it must already be removed or reassigned.')) {
      return;
    }

    await submitConfig('region-pack', 'delete', async () => {
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

      resetRegionPackForm();
      return 'Region pack deleted.';
    });
  };

  const deleteCheckProfile = async (profileId: string) => {
    if (!confirm('Delete this saved check and its recorded run links?')) {
      return;
    }

    await submitConfig('check-profile', 'delete', async () => {
      const response = await fetch(`/api/control/check-profiles/${profileId}`, {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json'
        }
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Failed to delete saved check.');
      }

      resetProfileForm();
      return 'Check profile deleted.';
    });
  };

  const toggleRegionPackCode = (code: string) => {
    if (regionPackCodes.includes(code)) {
      regionPackCodes = regionPackCodes.filter((value) => value !== code);
      return;
    }

    if (regionPackCodes.length >= maxSelectableRegions) {
      configActionError = `A region set can include up to ${maxSelectableRegions} active regions right now.`;
      return;
    }

    configActionError = null;
    regionPackCodes = [...regionPackCodes, code];
  };

  const submitConfig = async (kind: string, actionName: 'create' | 'update' | 'delete', action: () => Promise<string>) => {
    savingConfigKind = `${kind}:${actionName}`;
    configActionError = null;
    configActionMessage = null;

    try {
      const message = await action();
      configActionMessage = message;
      await refreshControlData();
    } catch (error) {
      configActionError =
        error instanceof Error ? error.message : `Failed to ${actionName} ${kind.replace('-', ' ')}.`;
    } finally {
      savingConfigKind = null;
    }
  };

  const parseRouteEntries = (value: string) => {
    const lines = value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      throw new Error('Enter at least one route in the route group.');
    }

    return lines.map((line, index) => {
      const [label, url] = line.split('|').map((item) => item?.trim() ?? '');

      if (!label || !url) {
        throw new Error(`Route line ${index + 1} must use "Label | https://example.com/path".`);
      }

      return { label, url };
    });
  };

  const parseHeaderEntries = (value: string): RequestHeader[] =>
    value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const separator = line.indexOf(':');

        if (separator < 1) {
          throw new Error(`Header line ${index + 1} must use "Header-Name: value".`);
        }

        return {
          name: line.slice(0, separator).trim(),
          value: line.slice(separator + 1).trim()
        };
      });

  const buildRequestConfig = (
    method: string,
    headersText: string,
    bodyText: string,
    contentType: string
  ) => ({
    method,
    headers: parseHeaderEntries(headersText),
    body: bodyText
      ? {
          mode: 'text' as const,
          contentType: contentType || undefined,
          value: bodyText
        }
      : null
  });

  const stringifyHeaders = (headers: RequestHeader[]) =>
    headers.map((header) => `${header.name}: ${header.value}`).join('\n');

  const parseWebhookTargets = (value: string) =>
    value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const [name, url, secret] = line.split('|').map((item) => item?.trim() ?? '');

        if (!name || !url) {
          throw new Error(
            `Webhook line ${index + 1} must use "Name | https://example.com/webhook | optional-secret".`
          );
        }

        return {
          name,
          url,
          secret: secret || undefined,
          enabled: true
        };
      });

  const stringifyWebhookTargets = (
    targets: NonNullable<CheckProfile['alerts']>['webhookTargets']
  ) => targets.map((target) => [target.name, target.url, target.secret ?? ''].join(' | ')).join('\n');

  const formatRequestConfig = (request: CheckProfile['request'] | LatencyJobDetail['request']) => {
    if (!request) {
      return 'GET';
    }

    const headerCount = request.headers?.length ?? 0;
    return `${request.method} · ${headerCount} headers · ${request.body ? 'body' : 'no body'}`;
  };

  const formatMonitorSummary = (profile: CheckProfile) => {
    const monitorType = profile.monitorPolicy?.monitorType ?? 'latency';
    const threshold = profile.monitorPolicy?.latencyThresholdMs;
    return threshold ? `${monitorType} · threshold ${threshold} ms` : `${monitorType} · no threshold`;
  };

  const formatAlertSummary = (profile: CheckProfile) => {
    if (!profile.alerts?.enabled || (profile.alerts.webhookTargets?.length ?? 0) === 0) {
      return 'alerts off';
    }

    return `${profile.alerts.webhookTargets.length} webhook${
      profile.alerts.webhookTargets.length > 1 ? 's' : ''
    }`;
  };

  const downloadReport = async (profileId: string, format: 'json' | 'csv') => {
    profileActionError = null;
    profileActionMessage = null;

    try {
      const response = await fetch(
        `/api/control/check-profiles/${profileId}/report/export?format=${format}`
      );

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? 'Failed to export report.');
      }

      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = `${profileId}-report.${format}`;
      anchor.click();
      window.URL.revokeObjectURL(blobUrl);
      profileActionMessage = `Downloaded ${format.toUpperCase()} report.`;
    } catch (error) {
      profileActionError = error instanceof Error ? error.message : 'Failed to export report.';
    }
  };

  const comparisonSections = (profile: CheckProfile): ComparisonSection[] => {
    const sections: ComparisonSection[] = [];

    const latestComparison = getLatestComparison(profile.id);

    if (latestComparison) {
      sections.push({
        id: 'latest',
        title: 'Latest vs previous',
        subtitle: 'Auto-compares the newest run against the one before it.',
        comparison: latestComparison
      });
    }

    const baselineComparison = getBaselineComparison(profile.id);

    if (baselineComparison) {
      sections.push({
        id: 'baseline',
        title: 'Latest vs pinned baseline',
        subtitle: 'Keeps the newest run aligned to the run you marked as canonical.',
        comparison: baselineComparison
      });
    }

    return sections;
  };
</script>

<svelte:head>
  {#if turnstileSiteKey}
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  {/if}
</svelte:head>

{#if showOverview}
  <ManualRunPanel
    activeRegionPreview={activeRegionPreview}
    checkProfileCount={checkProfiles.length}
    controlModeDetail={controlModeDetail}
    controlModeLabel={controlModeLabel}
    regionCount={regions.length}
    savedChecksEnabled={Boolean(savedChecks)}
    selectableCount={selectableCount}
  >
    <form class="control-card" onsubmit={submitJob}>
      <div class="card-intro">
        <p class="eyebrow">Manual run</p>
        <h2>Launch a one-off verification</h2>
        <p class="card-copy">
          Use this for deploy smoke checks and incident verification, then save the setup as a
          reusable check if it belongs in the long-term release workflow.
        </p>
      </div>

      <FieldSet>
        <FieldSetTitle class="text-lg">Run details</FieldSetTitle>
        <FieldSetContent class="grid gap-4">
          <label class="field">
            <span>Site URL</span>
            <Input bind:value={targetUrl} name="url" type="url" placeholder="https://example.com" />
          </label>

          <label class="field">
            <span>Run note</span>
            <Input
              bind:value={note}
              name="note"
              maxlength={200}
              placeholder="release canary, home page, pricing flow..."
            />
          </label>

          <label class="field">
            <span>Monitor type</span>
            <Select bind:value={jobMonitorType}>
              <option value="latency">latency</option>
              <option value="uptime">uptime</option>
            </Select>
          </label>

          <label class="field">
            <span>Latency threshold ms</span>
            <Input bind:value={jobLatencyThresholdMs} inputmode="numeric" placeholder="400" />
          </label>

          <div class="field">
            <span>Selected regions</span>
            <strong>{selectedRegions.length} / {maxSelectableRegions}</strong>
          </div>

          <div class="field">
            <span>Quick region picks</span>
            <div class="pill-grid">
              {#each activeRegionOptions as region (region.code)}
                <Button
                  class={`pill-button ${selectedRegions.includes(region.code) ? 'selected' : ''}`}
                  variant="ghost"
                  type="button"
                  onclick={() => toggleRegion(region)}
                >
                  {region.label}
                </Button>
              {/each}
            </div>
          </div>
        </FieldSetContent>
      </FieldSet>

      <details class="advanced-panel">
        <summary>Advanced request overrides</summary>

        <FieldSet class="mt-3 border-line/70 bg-white/5">
          <FieldSetTitle class="text-base">Request overrides</FieldSetTitle>
          <FieldSetContent class="advanced-grid">
            <label class="field">
              <span>Request method</span>
              <Select bind:value={requestMethod}>
                <option value="GET">GET</option>
                <option value="HEAD">HEAD</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
                <option value="OPTIONS">OPTIONS</option>
              </Select>
            </label>

            <label class="field">
              <span>Custom headers</span>
              <Textarea
                bind:value={requestHeadersText}
                rows={3}
                placeholder="Authorization: Bearer sample-token&#10;X-Env: staging"
              />
            </label>

            <label class="field">
              <span>Request body</span>
              <Textarea
                bind:value={requestBody}
                rows={3}
                placeholder="&#123;&quot;release&quot;:&quot;2026.04.12&quot;&#125;"
              />
            </label>

            <label class="field">
              <span>Body content type</span>
              <Input bind:value={requestContentType} placeholder="application/json" />
            </label>
          </FieldSetContent>
        </FieldSet>
      </details>

    {#if turnstileSiteKey}
      <div class="turnstile-shell">
        <div class="cf-turnstile" data-sitekey={turnstileSiteKey}></div>
      </div>
    {:else}
      <p class="hint">Turnstile is optional in local dev and enforced when the site key is configured.</p>
    {/if}

    {#if submitError}
      <p class="error">{submitError}</p>
    {/if}

    {#if helperMessage}
      <p class="hint">{helperMessage}</p>
    {/if}

      <Button class="w-full justify-center" disabled={isSubmitting} size="lg" type="submit">
        {#if isSubmitting}Opening regional slots...{:else}Start measurement{/if}
      </Button>
    </form>
  </ManualRunPanel>

  <WorkspaceMap />

  <LiveRunResults>
    {#if job}
    <div class="job-summary">
      <div>
        <span>Job</span>
        <strong>{job.id}</strong>
      </div>
      <div>
        <span>Status</span>
        <strong>{job.status}</strong>
      </div>
      <div>
        <span>Request</span>
        <strong>{formatRequestConfig(job.request)}</strong>
      </div>
      <div>
        <span>Stream</span>
        <strong>{streamState}</strong>
      </div>
      <div>
        <span>Targets</span>
        <strong>{job.summary.succeeded} done / {job.summary.failed} failed / {job.summary.inflight} inflight</strong>
      </div>
      <div>
        <span>Monitor</span>
        <strong>{job.evaluation?.status ?? job.monitorPolicy?.monitorType ?? 'latency'}</strong>
      </div>
    </div>

    <div class="result-grid">
      {#each job.targets as target (target.region)}
        <LiveRunTargetCard {formatText} {formatTiming} {target} />
      {/each}
    </div>
    {:else}
      <div class="empty-state">
        <p>No verification is running yet.</p>
        <small>Start a manual run above and the control-plane stream will appear here immediately.</small>
      </div>
    {/if}
  </LiveRunResults>
{/if}

{#if showResources}
  <ResourceEditors
    propertyCount={properties.length}
    regionPackCount={regionPacks.length}
    routeSetCount={routeSets.length}
    savedChecksEnabled={Boolean(savedChecks)}
  >
    {#if savedChecks}
      <UnderlineTabs bind:value={resourceEditorTab} class="builder-card p-6">
        <UnderlineTabsList class="mb-4">
          <UnderlineTabsTrigger value="site">Sites</UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="route-group">Route groups</UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="region-set">Region sets</UnderlineTabsTrigger>
        </UnderlineTabsList>

        <UnderlineTabsContent value="site">
          <form onsubmit={submitProperty}>
            <FieldSet>
              <FieldSetTitle class="text-lg">
                {editingPropertyId ? 'Edit site' : 'Create site'}
              </FieldSetTitle>
              <FieldSetContent class="grid gap-4">
                <label class="field">
                  <span>Existing site</span>
                  <Select
                    bind:value={editingPropertyId}
                    onchange={(event: Event) =>
                      loadPropertyEditor((event.currentTarget as HTMLSelectElement).value)}
                  >
                    <option value="">Create new site</option>
                    {#each properties as property (property.id)}
                      <option value={property.id}>{property.name}</option>
                    {/each}
                  </Select>
                </label>
                <label class="field">
                  <span>Name</span>
                  <Input bind:value={propertyName} placeholder="Main site" />
                </label>
                <label class="field">
                  <span>Base URL</span>
                  <Input bind:value={propertyBaseUrl} type="url" placeholder="https://example.com" />
                </label>
              </FieldSetContent>
              <FieldSetFooter class="builder-actions">
                <Button type="submit" variant="secondary" disabled={isConfigBusy('property')}>
                  {#if isConfigBusy('property')}{editingPropertyId ? 'Updating...' : 'Saving...'}{:else}{editingPropertyId ? 'Update site' : 'Save site'}{/if}
                </Button>
                {#if editingPropertyId}
                  <Button variant="ghost" type="button" onclick={resetPropertyForm} disabled={isConfigBusy('property')}>Cancel</Button>
                  <Button variant="destructive" type="button" onclick={() => deleteProperty(editingPropertyId)} disabled={isConfigBusy('property')}>Delete</Button>
                {/if}
              </FieldSetFooter>
            </FieldSet>
          </form>
        </UnderlineTabsContent>

        <UnderlineTabsContent value="route-group">
          <form onsubmit={submitRouteSet}>
            <FieldSet>
              <FieldSetTitle class="text-lg">
                {editingRouteSetId ? 'Edit route group' : 'Create route group'}
              </FieldSetTitle>
              <FieldSetContent class="grid gap-4">
                <label class="field">
                  <span>Existing route group</span>
                  <Select
                    bind:value={editingRouteSetId}
                    onchange={(event: Event) =>
                      loadRouteSetEditor((event.currentTarget as HTMLSelectElement).value)}
                  >
                    <option value="">Create new route group</option>
                    {#each routeSets as routeSet (routeSet.id)}
                      <option value={routeSet.id}>
                        {routeSet.name} · {propertyById.get(routeSet.propertyId)?.name ?? 'Unknown site'}
                      </option>
                    {/each}
                  </Select>
                </label>
                <label class="field">
                  <span>Site</span>
                  <Select bind:value={routeSetPropertyId}>
                    <option value="">Select site</option>
                    {#each properties as property (property.id)}
                      <option value={property.id}>{property.name}</option>
                    {/each}
                  </Select>
                </label>
                <label class="field">
                  <span>Name</span>
                  <Input bind:value={routeSetName} placeholder="Core routes" />
                </label>
                <label class="field">
                  <span>Routes</span>
                  <Textarea
                    bind:value={routeSetRoutesText}
                    rows={4}
                    placeholder="Homepage | http://example.com&#10;Pricing | http://example.com/pricing"
                  />
                </label>
              </FieldSetContent>
              <FieldSetFooter class="builder-actions">
                <Button type="submit" variant="secondary" disabled={isConfigBusy('route-set')}>
                  {#if isConfigBusy('route-set')}{editingRouteSetId ? 'Updating...' : 'Saving...'}{:else}{editingRouteSetId ? 'Update route group' : 'Save route group'}{/if}
                </Button>
                {#if editingRouteSetId}
                  <Button variant="ghost" type="button" onclick={resetRouteSetForm} disabled={isConfigBusy('route-set')}>Cancel</Button>
                  <Button variant="destructive" type="button" onclick={() => deleteRouteSet(editingRouteSetId)} disabled={isConfigBusy('route-set')}>Delete</Button>
                {/if}
              </FieldSetFooter>
            </FieldSet>
          </form>
        </UnderlineTabsContent>

        <UnderlineTabsContent value="region-set">
          <form onsubmit={submitRegionPack}>
            <FieldSet>
              <FieldSetTitle class="text-lg">
                {editingRegionPackId ? 'Edit region set' : 'Create region set'}
              </FieldSetTitle>
              <FieldSetContent class="grid gap-4">
                <label class="field">
                  <span>Existing region set</span>
                  <Select
                    bind:value={editingRegionPackId}
                    onchange={(event: Event) =>
                      loadRegionPackEditor((event.currentTarget as HTMLSelectElement).value)}
                  >
                    <option value="">Create new region set</option>
                    {#each regionPacks as regionPack (regionPack.id)}
                      <option value={regionPack.id}>{regionPack.name}</option>
                    {/each}
                  </Select>
                </label>
                <label class="field">
                  <span>Name</span>
                  <Input bind:value={regionPackName} placeholder="APAC core" />
                </label>
                <label class="field">
                  <span>Selected region codes</span>
                  <TagsInput
                    bind:value={regionPackCodes}
                    placeholder="Add active region codes"
                    restrictToSuggestions
                    suggestions={activeRegionCodeSuggestions}
                  />
                </label>
                <div class="field">
                  <span>Regions</span>
                  <div class="pill-grid">
                    {#each activeRegionOptions as region (region.code)}
                      <Button
                        class={`pill-button ${regionPackCodes.includes(region.code) ? 'selected' : ''}`}
                        variant="ghost"
                        type="button"
                        onclick={() => toggleRegionPackCode(region.code)}
                      >
                        {region.label}
                      </Button>
                    {/each}
                  </div>
                </div>
              </FieldSetContent>
              <FieldSetFooter class="builder-actions">
                <Button type="submit" variant="secondary" disabled={isConfigBusy('region-pack')}>
                  {#if isConfigBusy('region-pack')}{editingRegionPackId ? 'Updating...' : 'Saving...'}{:else}{editingRegionPackId ? 'Update region set' : 'Save region set'}{/if}
                </Button>
                {#if editingRegionPackId}
                  <Button variant="ghost" type="button" onclick={resetRegionPackForm} disabled={isConfigBusy('region-pack')}>Cancel</Button>
                  <Button variant="destructive" type="button" onclick={() => deleteRegionPack(editingRegionPackId)} disabled={isConfigBusy('region-pack')}>Delete</Button>
                {/if}
              </FieldSetFooter>
            </FieldSet>
          </form>
        </UnderlineTabsContent>
      </UnderlineTabs>

    {#if configActionError}
      <p class="error">{configActionError}</p>
    {/if}

    {#if configActionMessage}
      <p class="hint">{configActionMessage}</p>
    {/if}
    {/if}
  </ResourceEditors>
{/if}

{#if showChecks}
  <SavedChecksWorkspace
    checkProfilesCount={checkProfiles.length}
    pinnedBaselineCount={pinnedBaselineCount}
    savedChecksEnabled={Boolean(savedChecks)}
    scheduledCheckCount={scheduledCheckCount}
    totalRecordedRuns={totalRecordedRuns}
  >
    {#if savedChecks}
    <div class="builder-grid check-builder-grid">
      <form class="builder-card" onsubmit={submitCheckProfile}>
        <h3>{editingProfileId ? 'Edit saved check' : 'Create saved check'}</h3>
        <FieldSet class="mb-4">
          <FieldSetTitle class="text-base">Scope</FieldSetTitle>
          <FieldSetContent class="grid gap-4">
            <label class="field">
              <span>Existing check</span>
              <Select
                bind:value={editingProfileId}
                onchange={(event: Event) =>
                  loadProfileEditor((event.currentTarget as HTMLSelectElement).value)}
              >
                <option value="">Create new saved check</option>
                {#each checkProfiles as profile (profile.id)}
                  <option value={profile.id}>{profile.name}</option>
                {/each}
              </Select>
            </label>
            <label class="field">
              <span>Site</span>
              <Select bind:value={profilePropertyId}>
                <option value="">Select site</option>
                {#each properties as property (property.id)}
                  <option value={property.id}>{property.name}</option>
                {/each}
              </Select>
            </label>
            <label class="field">
              <span>Route group</span>
              <Select bind:value={profileRouteSetId}>
                <option value="">Select route group</option>
                {#each routeSets as routeSet (routeSet.id)}
                  <option value={routeSet.id}>{routeSet.name}</option>
                {/each}
              </Select>
            </label>
            <label class="field">
              <span>Region set</span>
              <Select bind:value={profileRegionPackId}>
                <option value="">Select region set</option>
                {#each regionPacks as regionPack (regionPack.id)}
                  <option value={regionPack.id}>{regionPack.name}</option>
                {/each}
              </Select>
            </label>
            <label class="field">
              <span>Name</span>
              <Input bind:value={profileName} placeholder="Release gate" />
            </label>
            <label class="field">
              <span>Note</span>
              <Input bind:value={profileNote} placeholder="critical pages" />
            </label>
          </FieldSetContent>
        </FieldSet>

        <FieldSet class="mb-4">
          <FieldSetTitle class="text-base">Request and policy</FieldSetTitle>
          <FieldSetContent class="grid gap-4">
            <label class="field">
              <span>Request method</span>
              <Select bind:value={profileRequestMethod}>
                <option value="GET">GET</option>
                <option value="HEAD">HEAD</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
                <option value="OPTIONS">OPTIONS</option>
              </Select>
            </label>
            <label class="field">
              <span>Request headers</span>
              <Textarea
                bind:value={profileRequestHeadersText}
                rows={3}
                placeholder="Authorization: Bearer sample-token&#10;X-Env: staging"
              />
            </label>
            <label class="field">
              <span>Request body</span>
              <Textarea
                bind:value={profileRequestBody}
                rows={3}
                placeholder="&#123;&quot;release&quot;:&quot;2026.04.12&quot;&#125;"
              />
            </label>
            <label class="field">
              <span>Body content type</span>
              <Input bind:value={profileRequestContentType} placeholder="application/json" />
            </label>
            <label class="field">
              <span>Monitor type</span>
              <Select bind:value={profileMonitorType}>
                <option value="latency">latency</option>
                <option value="uptime">uptime</option>
              </Select>
            </label>
            <label class="field">
              <span>Latency threshold ms</span>
              <Input bind:value={profileLatencyThresholdMs} inputmode="numeric" placeholder="400" />
            </label>
            <label class="field">
              <span>Schedule minutes</span>
              <Input bind:value={profileScheduleMinutes} inputmode="numeric" placeholder="5" />
            </label>
          </FieldSetContent>
        </FieldSet>

        <FieldSet>
          <FieldSetTitle class="text-base">Alerts</FieldSetTitle>
          <FieldSetContent class="grid gap-4">
            <label class="checkbox-field justify-between rounded-[var(--wp-radius-md)] border border-line px-4 py-3">
              <span>Enable webhook alerts</span>
              <Switch bind:checked={profileAlertEnabled} />
            </label>
            <div class="field">
              <span>Alert triggers</span>
              <div class="checkbox-list">
                <label class="checkbox-field">
                  <Checkbox bind:checked={profileAlertOnFailure} />
                  <span>Failed checks</span>
                </label>
                <label class="checkbox-field">
                  <Checkbox bind:checked={profileAlertOnThreshold} />
                  <span>Threshold breach</span>
                </label>
                <label class="checkbox-field">
                  <Checkbox bind:checked={profileAlertOnRegression} />
                  <span>Baseline regression</span>
                </label>
              </div>
            </div>
            <label class="field">
              <span>Webhook targets</span>
              <Textarea
                bind:value={profileWebhookTargetsText}
                rows={3}
                placeholder="Primary | https://example.com/hooks/webperf | optional-secret"
              />
            </label>
          </FieldSetContent>
          <FieldSetFooter class="builder-actions">
            <Button type="submit" variant="secondary" disabled={isConfigBusy('check-profile')}>
              {#if isConfigBusy('check-profile')}{editingProfileId ? 'Updating...' : 'Saving...'}{:else}{editingProfileId ? 'Update saved check' : 'Save saved check'}{/if}
            </Button>
            {#if editingProfileId}
              <Button variant="ghost" type="button" onclick={resetProfileForm} disabled={isConfigBusy('check-profile')}>Cancel</Button>
              <Button variant="destructive" type="button" onclick={() => deleteCheckProfile(editingProfileId)} disabled={isConfigBusy('check-profile')}>Delete</Button>
            {/if}
          </FieldSetFooter>
        </FieldSet>
      </form>

      <article class="builder-card builder-guide">
        <h3>Saved check loop</h3>
        <p class="card-copy">
          Build one check around a real release decision, then keep the review loop consistent:
          run it, pin a trustworthy baseline, compare the next run, and export the resulting evidence.
        </p>

        <div class="guide-grid">
          <div>
            <span>Definition</span>
            <strong>site + route group + region set</strong>
          </div>
          <div>
            <span>Execution</span>
            <strong>manual run or scheduler interval</strong>
          </div>
          <div>
            <span>Decision</span>
            <strong>threshold, regression, webhook alerts</strong>
          </div>
          <div>
            <span>Evidence</span>
            <strong>report export, comparisons, recent runs</strong>
          </div>
        </div>
      </article>
    </div>

    {#if profileActionError}
      <p class="error">{profileActionError}</p>
    {/if}

    {#if profileActionMessage}
      <p class="hint">{profileActionMessage}</p>
    {/if}

    {#if checkProfiles.length > 0}
      <div class="list-toolbar">
        <label class="field grow">
          <span>Browse saved checks</span>
          <Input bind:value={checkProfileFilterDraft} placeholder="check name, note, site, route group" />
        </label>
        <label class="field inline-field">
          <span>Page size</span>
          <NumberField bind:value={checkProfilePageSize} max={10} min={4} step={2}>
            <NumberFieldGroup>
              <NumberFieldDecrement />
              <NumberFieldInput aria-label="Saved check page size" oninput={() => resetCheckProfilePaging()} />
              <NumberFieldIncrement />
            </NumberFieldGroup>
          </NumberField>
        </label>
        <div class="saved-actions">
          <Button variant="secondary" type="button" onclick={applyCheckProfileFilter}>Apply</Button>
          <Button variant="ghost" type="button" onclick={clearCheckProfileFilter}>Clear</Button>
        </div>
      </div>

      <div class="pagination-bar">
        <small>
          Showing {visibleCheckProfiles.length} of {checkProfilePageInfo.totalCount}
          {#if checkProfilePageInfo.filter}
            for "{checkProfilePageInfo.filter}"
          {/if}
        </small>

        <div class="saved-actions">
          <Button variant="ghost" type="button" onclick={goToPreviousCheckProfilePage} disabled={checkProfilePreviousTokens.length === 0}>
            Previous
          </Button>
          <Button variant="ghost" type="button" onclick={goToNextCheckProfilePage} disabled={!checkProfilePageInfo.nextPageToken}>
            Next
          </Button>
        </div>
      </div>

      <div class="saved-grid">
        {#each visibleCheckProfiles as profile (profile.id)}
          <SavedCheckCard
            baselineBusy={baselineActionProfileId === profile.id}
            comparisonSections={comparisonSections(profile)}
            configBusy={isConfigBusy('check-profile')}
            formatAlertSummary={formatAlertSummary}
            formatDateTime={formatDateTime}
            formatMonitorSummary={formatMonitorSummary}
            formatRequestConfig={formatRequestConfig}
            formatSchedule={formatSchedule}
            {formatText}
            {formatTiming}
            isBaselineRun={isBaselineRun}
            onClearBaseline={clearBaseline}
            onDelete={deleteCheckProfile}
            onDownloadReport={downloadReport}
            onEdit={loadProfileEditor}
            onPinBaseline={pinBaseline}
            onRun={runCheckProfile}
            profile={profile}
            propertyName={getPropertyName(profile)}
            recentRunDetails={getRecentRunDetails(profile.id)}
            regionPackName={getRegionPackName(profile)}
            report={getReport(profile.id)}
            routeSetName={getRouteSetName(profile)}
            running={runningProfileId === profile.id}
          />
        {/each}
      </div>
    {:else}
      <div class="empty-state">
        <p>No saved checks yet.</p>
        <small>Create a site, route group, region set, and saved check above, then run it manually or through the scheduler endpoint.</small>
      </div>
    {/if}
  {:else}
      <div class="empty-state">
        <p>This control endpoint is running in live-check mode only.</p>
        <small>Manual runs still work, but persistent sites, route groups, region sets, baselines, and exports require the full self-host API service.</small>
      </div>
    {/if}
  </SavedChecksWorkspace>
{/if}

{#if showReports}
  <ReportsWorkspace savedChecksEnabled={Boolean(savedChecks)}>
    {#if savedChecks}
      <Tabs bind:value={reportWorkspaceTab}>
        <TabsList variant="line" class="w-full">
          <TabsTrigger value="browser">Derived browser</TabsTrigger>
          <TabsTrigger value="endpoints">API endpoints</TabsTrigger>
        </TabsList>
        <TabsContent value="browser">
          <ScrollArea class="max-h-[72vh] rounded-[var(--wp-radius-lg)] border border-line p-1">
            <DerivedResourceBrowser />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="endpoints">
          <Card class="p-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Resource</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead class="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Comparisons</TableCell>
                  <TableCell>Query persisted comparison payloads for CI and manual incident review.</TableCell>
                  <TableCell><code>/api/control/comparisons</code></TableCell>
                  <TableCell class="text-right">
                    <CopyButton text="/api/control/comparisons">Copy path</CopyButton>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Exports</TableCell>
                  <TableCell>Retrieve deterministic JSON or CSV report exports for release evidence.</TableCell>
                  <TableCell><code>/api/control/exports</code></TableCell>
                  <TableCell class="text-right">
                    <CopyButton text="/api/control/exports">Copy path</CopyButton>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    {/if}
  </ReportsWorkspace>
{/if}

{#if showRegions}
  <RegionCatalog regionCount={regions.length} selectableCount={selectableCount}>
    <ScrollArea class="max-h-[72vh] rounded-[var(--wp-radius-lg)] border border-line p-1">
      <div class="continents pr-3">
        {#each groupedRegions as group (group.continent)}
          <RegionContinentCard
            continent={group.continent}
            regions={group.regions}
            {selectedRegions}
            toggleRegion={toggleRegion}
          />
        {/each}
      </div>
    </ScrollArea>
  </RegionCatalog>
{/if}
