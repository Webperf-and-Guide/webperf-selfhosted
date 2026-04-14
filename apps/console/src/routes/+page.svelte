<script lang="ts">
  import { browser } from '$app/environment';
  import { invalidateAll } from '$app/navigation';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import DerivedResourceBrowser from '$lib/components/DerivedResourceBrowser.svelte';
  import { fetchControlJson } from '$lib/client/control-query';
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
  import type { PageData } from './$types';
  import { onDestroy } from 'svelte';

  let { data } = $props<{ data: PageData }>();
  type SavedChecksData = NonNullable<PageData['savedChecks']>;
  type SavedProfileMeta = SavedChecksData['profileMeta'][number];
  const queryClient = useQueryClient();

  const maxSelectableRegions = 4;
  const regions = $derived.by(() => data.regions);
  const turnstileSiteKey = $derived.by(() => data.turnstileSiteKey);
  const savedChecks = $derived.by(() => data.savedChecks);
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

  const changeCheckProfilePageSize = (nextValue: string) => {
    checkProfilePageSize = Number(nextValue);
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

  const comparisonSections = (profile: CheckProfile) => {
    const sections: Array<{
      id: string;
      title: string;
      subtitle: string;
      comparison: CheckProfileLatestComparisonResponse | CheckProfileComparisonResponse;
    }> = [];

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

<section class="hero" id="measure">
  <div class="hero-copy">
    <p class="eyebrow">Self-host operator console</p>
    <h1>Run a check now, then turn it into a reusable release gate.</h1>
    <p class="lede">
      This is the working surface for one self-hosted WebPerf deployment: launch a manual
      verification, inspect the live control-plane stream, then save repeatable checks with route
      groups, region sets, baselines, schedules, and exports.
    </p>

    <div class="hero-metrics">
      <div>
        <span>Control plane</span>
        <strong>{controlModeLabel}</strong>
        <small>{controlModeDetail}</small>
      </div>
      <div>
        <span>Active regions</span>
        <strong>{selectableCount} active / {regions.length} modeled</strong>
        <small>{activeRegionPreview}</small>
      </div>
      <div>
        <span>Saved checks</span>
        <strong>{savedChecks ? `${checkProfiles.length} reusable checks` : 'Manual runs only'}</strong>
        <small>{savedChecks ? 'Promote stable runs into schedules, baselines, and exports.' : 'Connect the full self-host API service to unlock persistent resources.'}</small>
      </div>
    </div>
  </div>

  <form class="control-card" onsubmit={submitJob}>
    <div class="card-intro">
      <p class="eyebrow">Manual run</p>
      <h2>Launch a one-off verification</h2>
      <p class="card-copy">
        Use this for deploy smoke checks and incident verification, then save the setup as a
        reusable check if it belongs in the long-term release workflow.
      </p>
    </div>

    <label class="field">
      <span>Site URL</span>
      <input bind:value={targetUrl} name="url" type="url" placeholder="https://example.com" />
    </label>

    <label class="field">
      <span>Run note</span>
      <input bind:value={note} name="note" maxlength="200" placeholder="release canary, home page, pricing flow..." />
    </label>

    <label class="field">
      <span>Monitor type</span>
      <select bind:value={jobMonitorType}>
        <option value="latency">latency</option>
        <option value="uptime">uptime</option>
      </select>
    </label>

    <label class="field">
      <span>Latency threshold ms</span>
      <input bind:value={jobLatencyThresholdMs} inputmode="numeric" placeholder="400" />
    </label>

    <div class="field">
      <span>Selected regions</span>
      <strong>{selectedRegions.length} / {maxSelectableRegions}</strong>
    </div>

    <details class="advanced-panel">
      <summary>Advanced request overrides</summary>

      <div class="advanced-grid">
        <label class="field">
          <span>Request method</span>
          <select bind:value={requestMethod}>
            <option value="GET">GET</option>
            <option value="HEAD">HEAD</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
            <option value="OPTIONS">OPTIONS</option>
          </select>
        </label>

        <label class="field">
          <span>Custom headers</span>
          <textarea
            bind:value={requestHeadersText}
            rows="3"
            placeholder="Authorization: Bearer sample-token&#10;X-Env: staging"
          ></textarea>
        </label>

        <label class="field">
          <span>Request body</span>
          <textarea
            bind:value={requestBody}
            rows="3"
            placeholder="&#123;&quot;release&quot;:&quot;2026.04.12&quot;&#125;"
          ></textarea>
        </label>

        <label class="field">
          <span>Body content type</span>
          <input bind:value={requestContentType} placeholder="application/json" />
        </label>
      </div>
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

    <button class="submit" disabled={isSubmitting}>
      {#if isSubmitting}Opening regional slots...{:else}Start measurement{/if}
    </button>
  </form>
</section>

<section class="results-section" id="results">
  <div class="section-heading">
    <p class="eyebrow">Live run state</p>
    <h2>Watch the current verification stream back from the control plane.</h2>
  </div>

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
        <article class="result-card">
          <div class="result-head">
            <strong>{target.region}</strong>
            <span>{target.status}</span>
          </div>

          <dl>
            <div>
              <dt>Attempt</dt>
              <dd>{target.attemptNo}</dd>
            </div>
            <div>
              <dt>Latency</dt>
              <dd>{target.latencyMs == null ? 'pending' : `${target.latencyMs} ms`}</dd>
            </div>
            <div>
              <dt>Status code</dt>
              <dd>{target.statusCode ?? 'n/a'}</dd>
            </div>
            <div>
              <dt>Implementation</dt>
              <dd>{target.probeImpl ?? 'pending'}</dd>
            </div>
            <div>
              <dt>Slot</dt>
              <dd>{target.slotId ?? 'allocating'}</dd>
            </div>
          </dl>

          {#if target.measurement}
            <div class="measurement-details">
              <div>
                <span>Final URL</span>
                <strong>{formatText(target.measurement.finalUrl)}</strong>
              </div>
              <div>
                <span>Redirects</span>
                <strong>{target.measurement.redirectCount}</strong>
              </div>
              <div>
                <span>Total</span>
                <strong>{formatTiming(target.measurement.timings.totalMs)}</strong>
              </div>
              <div>
                <span>DNS</span>
                <strong>{formatTiming(target.measurement.timings.dnsMs)}</strong>
              </div>
              <div>
                <span>TCP</span>
                <strong>{formatTiming(target.measurement.timings.tcpMs)}</strong>
              </div>
              <div>
                <span>TLS</span>
                <strong>{formatTiming(target.measurement.timings.tlsMs)}</strong>
              </div>
              <div>
                <span>TTFB</span>
                <strong>{formatTiming(target.measurement.timings.ttfbMs)}</strong>
              </div>
              <div>
                <span>TLS version</span>
                <strong>{formatText(target.measurement.tls?.version)}</strong>
              </div>
              <div>
                <span>ALPN</span>
                <strong>{formatText(target.measurement.tls?.alpn)}</strong>
              </div>
              <div>
                <span>Cipher</span>
                <strong>{formatText(target.measurement.tls?.cipherSuite)}</strong>
              </div>
              <div>
                <span>Server name</span>
                <strong>{formatText(target.measurement.tls?.serverName)}</strong>
              </div>
            </div>
          {/if}

          {#if target.errorMessage}
            <p class="error">{target.errorMessage}</p>
          {/if}
        </article>
      {/each}
    </div>
  {:else}
    <div class="empty-state">
      <p>No verification is running yet.</p>
      <small>Start a manual run above and the control-plane stream will appear here immediately.</small>
    </div>
  {/if}
</section>

<section class="saved-section" id="saved-checks">
  <div class="section-heading">
    <p class="eyebrow">Reusable checks</p>
    <h2>Save operator-ready checks, schedules, baselines, and exports.</h2>
  </div>

  {#if savedChecks}
    <div class="saved-summary setup-flow">
      <div>
        <span>1. Site</span>
        <strong>Define the deployment root</strong>
        <small>Store the base URL once so route groups and checks can reference it.</small>
      </div>
      <div>
        <span>2. Route group</span>
        <strong>Bundle the release-critical URLs</strong>
        <small>Keep homepage, pricing, auth, or SEO-sensitive routes together.</small>
      </div>
      <div>
        <span>3. Region set</span>
        <strong>Choose the active corridor</strong>
        <small>Pin the launch regions you want each reusable check to cover.</small>
      </div>
      <div>
        <span>4. Saved check</span>
        <strong>Schedule, run, diff, and export</strong>
        <small>Promote stable manual runs into baseline-aware release gates.</small>
      </div>
    </div>

    <div class="builder-grid">
      <form class="builder-card" onsubmit={submitProperty}>
        <h3>{editingPropertyId ? 'Edit site' : 'Create site'}</h3>
        <label class="field">
          <span>Existing site</span>
          <select bind:value={editingPropertyId} onchange={(event) => loadPropertyEditor((event.currentTarget as HTMLSelectElement).value)}>
            <option value="">Create new site</option>
            {#each properties as property (property.id)}
              <option value={property.id}>{property.name}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          <span>Name</span>
          <input bind:value={propertyName} placeholder="Main site" />
        </label>
        <label class="field">
          <span>Base URL</span>
          <input bind:value={propertyBaseUrl} type="url" placeholder="https://example.com" />
        </label>
        <div class="builder-actions">
          <button class="secondary-button" disabled={isConfigBusy('property')}>
            {#if isConfigBusy('property')}{editingPropertyId ? 'Updating...' : 'Saving...'}{:else}{editingPropertyId ? 'Update site' : 'Save site'}{/if}
          </button>
          {#if editingPropertyId}
            <button class="ghost-button" type="button" onclick={resetPropertyForm} disabled={isConfigBusy('property')}>Cancel</button>
            <button class="danger-button" type="button" onclick={() => deleteProperty(editingPropertyId)} disabled={isConfigBusy('property')}>Delete</button>
          {/if}
        </div>
      </form>

      <form class="builder-card" onsubmit={submitRouteSet}>
        <h3>{editingRouteSetId ? 'Edit route group' : 'Create route group'}</h3>
        <label class="field">
          <span>Existing route group</span>
          <select bind:value={editingRouteSetId} onchange={(event) => loadRouteSetEditor((event.currentTarget as HTMLSelectElement).value)}>
            <option value="">Create new route group</option>
            {#each routeSets as routeSet (routeSet.id)}
              <option value={routeSet.id}>
                {routeSet.name} · {propertyById.get(routeSet.propertyId)?.name ?? 'Unknown site'}
              </option>
            {/each}
          </select>
        </label>
        <label class="field">
          <span>Site</span>
          <select bind:value={routeSetPropertyId}>
            <option value="">Select site</option>
            {#each properties as property (property.id)}
              <option value={property.id}>{property.name}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          <span>Name</span>
          <input bind:value={routeSetName} placeholder="Core routes" />
        </label>
        <label class="field">
          <span>Routes</span>
          <textarea
            bind:value={routeSetRoutesText}
            rows="4"
            placeholder="Homepage | http://example.com&#10;Pricing | http://example.com/pricing"
          ></textarea>
        </label>
        <div class="builder-actions">
          <button class="secondary-button" disabled={isConfigBusy('route-set')}>
            {#if isConfigBusy('route-set')}{editingRouteSetId ? 'Updating...' : 'Saving...'}{:else}{editingRouteSetId ? 'Update route group' : 'Save route group'}{/if}
          </button>
          {#if editingRouteSetId}
            <button class="ghost-button" type="button" onclick={resetRouteSetForm} disabled={isConfigBusy('route-set')}>Cancel</button>
            <button class="danger-button" type="button" onclick={() => deleteRouteSet(editingRouteSetId)} disabled={isConfigBusy('route-set')}>Delete</button>
          {/if}
        </div>
      </form>

      <form class="builder-card" onsubmit={submitRegionPack}>
        <h3>{editingRegionPackId ? 'Edit region set' : 'Create region set'}</h3>
        <label class="field">
          <span>Existing region set</span>
          <select bind:value={editingRegionPackId} onchange={(event) => loadRegionPackEditor((event.currentTarget as HTMLSelectElement).value)}>
            <option value="">Create new region set</option>
            {#each regionPacks as regionPack (regionPack.id)}
              <option value={regionPack.id}>{regionPack.name}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          <span>Name</span>
          <input bind:value={regionPackName} placeholder="APAC core" />
        </label>
        <div class="field">
          <span>Regions</span>
          <div class="pill-grid">
            {#each activeRegionOptions as region (region.code)}
              <button
                class:selected={regionPackCodes.includes(region.code)}
                class="pill-button"
                type="button"
                onclick={() => toggleRegionPackCode(region.code)}
              >
                {region.label}
              </button>
            {/each}
          </div>
        </div>
        <div class="builder-actions">
          <button class="secondary-button" disabled={isConfigBusy('region-pack')}>
            {#if isConfigBusy('region-pack')}{editingRegionPackId ? 'Updating...' : 'Saving...'}{:else}{editingRegionPackId ? 'Update region set' : 'Save region set'}{/if}
          </button>
          {#if editingRegionPackId}
            <button class="ghost-button" type="button" onclick={resetRegionPackForm} disabled={isConfigBusy('region-pack')}>Cancel</button>
            <button class="danger-button" type="button" onclick={() => deleteRegionPack(editingRegionPackId)} disabled={isConfigBusy('region-pack')}>Delete</button>
          {/if}
        </div>
      </form>

      <form class="builder-card" onsubmit={submitCheckProfile}>
        <h3>{editingProfileId ? 'Edit saved check' : 'Create saved check'}</h3>
        <label class="field">
          <span>Existing check</span>
          <select bind:value={editingProfileId} onchange={(event) => loadProfileEditor((event.currentTarget as HTMLSelectElement).value)}>
            <option value="">Create new saved check</option>
            {#each checkProfiles as profile (profile.id)}
              <option value={profile.id}>{profile.name}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          <span>Site</span>
          <select bind:value={profilePropertyId}>
            <option value="">Select site</option>
            {#each properties as property (property.id)}
              <option value={property.id}>{property.name}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          <span>Route group</span>
          <select bind:value={profileRouteSetId}>
            <option value="">Select route group</option>
            {#each routeSets as routeSet (routeSet.id)}
              <option value={routeSet.id}>{routeSet.name}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          <span>Region set</span>
          <select bind:value={profileRegionPackId}>
            <option value="">Select region set</option>
            {#each regionPacks as regionPack (regionPack.id)}
              <option value={regionPack.id}>{regionPack.name}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          <span>Name</span>
          <input bind:value={profileName} placeholder="Release gate" />
        </label>
        <label class="field">
          <span>Note</span>
          <input bind:value={profileNote} placeholder="critical pages" />
        </label>
        <label class="field">
          <span>Request method</span>
          <select bind:value={profileRequestMethod}>
            <option value="GET">GET</option>
            <option value="HEAD">HEAD</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
            <option value="OPTIONS">OPTIONS</option>
          </select>
        </label>
        <label class="field">
          <span>Request headers</span>
          <textarea
            bind:value={profileRequestHeadersText}
            rows="3"
            placeholder="Authorization: Bearer sample-token&#10;X-Env: staging"
          ></textarea>
        </label>
        <label class="field">
          <span>Request body</span>
          <textarea
            bind:value={profileRequestBody}
            rows="3"
            placeholder="&#123;&quot;release&quot;:&quot;2026.04.12&quot;&#125;"
          ></textarea>
        </label>
        <label class="field">
          <span>Body content type</span>
          <input bind:value={profileRequestContentType} placeholder="application/json" />
        </label>
        <label class="field">
          <span>Monitor type</span>
          <select bind:value={profileMonitorType}>
            <option value="latency">latency</option>
            <option value="uptime">uptime</option>
          </select>
        </label>
        <label class="field">
          <span>Latency threshold ms</span>
          <input bind:value={profileLatencyThresholdMs} inputmode="numeric" placeholder="400" />
        </label>
        <label class="field">
          <span>Schedule minutes</span>
          <input bind:value={profileScheduleMinutes} inputmode="numeric" placeholder="5" />
        </label>
        <label class="checkbox-field">
          <input bind:checked={profileAlertEnabled} type="checkbox" />
          <span>Enable webhook alerts</span>
        </label>
        <div class="field">
          <span>Alert triggers</span>
          <div class="checkbox-list">
            <label class="checkbox-field">
              <input bind:checked={profileAlertOnFailure} type="checkbox" />
              <span>Failed checks</span>
            </label>
            <label class="checkbox-field">
              <input bind:checked={profileAlertOnThreshold} type="checkbox" />
              <span>Threshold breach</span>
            </label>
            <label class="checkbox-field">
              <input bind:checked={profileAlertOnRegression} type="checkbox" />
              <span>Baseline regression</span>
            </label>
          </div>
        </div>
        <label class="field">
          <span>Webhook targets</span>
          <textarea
            bind:value={profileWebhookTargetsText}
            rows="3"
            placeholder="Primary | https://example.com/hooks/webperf | optional-secret"
          ></textarea>
        </label>
        <div class="builder-actions">
          <button class="secondary-button" disabled={isConfigBusy('check-profile')}>
            {#if isConfigBusy('check-profile')}{editingProfileId ? 'Updating...' : 'Saving...'}{:else}{editingProfileId ? 'Update saved check' : 'Save saved check'}{/if}
          </button>
          {#if editingProfileId}
            <button class="ghost-button" type="button" onclick={resetProfileForm} disabled={isConfigBusy('check-profile')}>Cancel</button>
            <button class="danger-button" type="button" onclick={() => deleteCheckProfile(editingProfileId)} disabled={isConfigBusy('check-profile')}>Delete</button>
          {/if}
        </div>
      </form>
    </div>

    {#if configActionError}
      <p class="error">{configActionError}</p>
    {/if}

    {#if configActionMessage}
      <p class="hint">{configActionMessage}</p>
    {/if}

    <div class="saved-summary">
      <div>
        <span>Sites</span>
        <strong>{properties.length}</strong>
      </div>
      <div>
        <span>Route groups</span>
        <strong>{routeSets.length}</strong>
      </div>
      <div>
        <span>Region sets</span>
        <strong>{regionPacks.length}</strong>
      </div>
      <div>
        <span>Saved checks</span>
        <strong>{checkProfiles.length}</strong>
      </div>
    </div>

    <DerivedResourceBrowser />

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
          <input bind:value={checkProfileFilterDraft} placeholder="check name, note, site, route group" />
        </label>
        <label class="field inline-field">
          <span>Page size</span>
          <select bind:value={checkProfilePageSize} onchange={(event) => changeCheckProfilePageSize((event.currentTarget as HTMLSelectElement).value)}>
            <option value="4">4</option>
            <option value="6">6</option>
            <option value="10">10</option>
          </select>
        </label>
        <div class="saved-actions">
          <button class="secondary-button" type="button" onclick={applyCheckProfileFilter}>Apply</button>
          <button class="ghost-button" type="button" onclick={clearCheckProfileFilter}>Clear</button>
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
          <button class="ghost-button" type="button" onclick={goToPreviousCheckProfilePage} disabled={checkProfilePreviousTokens.length === 0}>
            Previous
          </button>
          <button class="ghost-button" type="button" onclick={goToNextCheckProfilePage} disabled={!checkProfilePageInfo.nextPageToken}>
            Next
          </button>
        </div>
      </div>

      <div class="saved-grid">
        {#each visibleCheckProfiles as profile (profile.id)}
          <article class="saved-card">
            <div class="saved-head">
              <div>
                <strong>{profile.name}</strong>
                <p class="saved-meta">
                  {getPropertyName(profile)} · {getRouteSetName(profile)} · {getRegionPackName(profile)}
                </p>
              </div>

              <div class="saved-actions">
                <button class="ghost-button" type="button" onclick={() => loadProfileEditor(profile.id)}>
                  Edit
                </button>
                <button class="danger-button" type="button" onclick={() => deleteCheckProfile(profile.id)} disabled={isConfigBusy('check-profile')}>
                  Delete
                </button>
                <button class="secondary-button" disabled={runningProfileId === profile.id} onclick={() => runCheckProfile(profile.id)}>
                  {#if runningProfileId === profile.id}Running...{:else}Run check{/if}
                </button>
              </div>
            </div>

            {#if profile.note}
              <p class="saved-note">{profile.note}</p>
            {/if}

            <div class="saved-stats">
              <div>
                <span>Schedule</span>
                <strong>{formatSchedule(profile.schedule?.intervalMinutes)}</strong>
              </div>
              <div>
                <span>Request</span>
                <strong>{formatRequestConfig(profile.request)}</strong>
              </div>
              <div>
                <span>Monitor</span>
                <strong>{formatMonitorSummary(profile)}</strong>
              </div>
              <div>
                <span>Alerts</span>
                <strong>{formatAlertSummary(profile)}</strong>
              </div>
              <div>
                <span>Next run</span>
                <strong>{formatDateTime(profile.schedule?.nextRunAt)}</strong>
              </div>
              <div>
                <span>Last run</span>
                <strong>{formatDateTime(profile.schedule?.lastRunAt)}</strong>
              </div>
              <div>
                <span>Recorded runs</span>
                <strong>{getRecentRuns(profile.id).length}</strong>
              </div>
              <div>
                <span>Baseline</span>
                <strong>{profile.baseline ? formatDateTime(profile.baseline.pinnedAt) : 'not pinned'}</strong>
              </div>
            </div>

            {#if getReport(profile.id)}
              <div class="comparison-block">
                <div class="comparison-heading">
                  <div>
                    <strong>Latest run report</strong>
                    <small>Compact health verdict plus export actions for this profile.</small>
                  </div>
                  <div class="saved-actions">
                    <button class="ghost-button" type="button" onclick={() => downloadReport(profile.id, 'json')}>
                      Export JSON
                    </button>
                    <button class="ghost-button" type="button" onclick={() => downloadReport(profile.id, 'csv')}>
                      Export CSV
                    </button>
                  </div>
                </div>

                <div class="comparison-summary">
                  <div>
                    <span>Status</span>
                    <strong>{getReport(profile.id)?.latestRunSummary?.status ?? 'n/a'}</strong>
                  </div>
                  <div>
                    <span>Monitor</span>
                    <strong>{getReport(profile.id)?.latestRunSummary?.evaluation?.monitorType ?? 'n/a'}</strong>
                  </div>
                  <div>
                    <span>Failed checks</span>
                    <strong>{getReport(profile.id)?.latestRunSummary?.evaluation?.failedChecks ?? 0}</strong>
                  </div>
                  <div>
                    <span>Threshold breach</span>
                    <strong>{getReport(profile.id)?.latestRunSummary?.evaluation?.thresholdBreached ? 'yes' : 'no'}</strong>
                  </div>
                  <div>
                    <span>Regression</span>
                    <strong>{getReport(profile.id)?.latestRunSummary?.evaluation?.regressionDetected ? 'yes' : 'no'}</strong>
                  </div>
                  <div>
                    <span>Alerts sent</span>
                    <strong>{getReport(profile.id)?.latestRunSummary?.alertDeliveries.length ?? 0}</strong>
                  </div>
                </div>
              </div>
            {/if}

            {#if comparisonSections(profile).length > 0}
              <div class="comparison-section-list">
                {#each comparisonSections(profile) as section (section.id)}
                  <section class="comparison-block">
                    <div class="comparison-heading">
                      <div>
                        <strong>{section.title}</strong>
                        <small>{section.subtitle}</small>
                      </div>
                      <span class="comparison-mode">{section.comparison.mode}</span>
                    </div>

                    <div class="comparison-summary">
                      <div>
                        <span>Improved</span>
                        <strong>{section.comparison.summary.improved}</strong>
                      </div>
                      <div>
                        <span>Regressed</span>
                        <strong>{section.comparison.summary.regressed}</strong>
                      </div>
                      <div>
                        <span>Unchanged</span>
                        <strong>{section.comparison.summary.unchanged}</strong>
                      </div>
                      <div>
                        <span>Regions compared</span>
                        <strong>{section.comparison.summary.regionsCompared}</strong>
                      </div>
                    </div>

                    <div class="comparison-routes">
                      {#each section.comparison.routes as route (route.routeId)}
                        <div class="comparison-route">
                          <div>
                            <strong>{route.routeLabel}</strong>
                            <small>{route.url}</small>
                          </div>

                          <div class="comparison-region-grid">
                            {#each route.regions as region (region.region)}
                              <div class="comparison-region-card" class:regressed={region.classification === 'regressed'} class:improved={region.classification === 'improved'}>
                                <div class="comparison-region-head">
                                  <strong>{region.region}</strong>
                                  <span>{region.classification}</span>
                                </div>
                                <div class="comparison-region-stats">
                                  <div>
                                    <span>Current</span>
                                    <strong>{formatTiming(region.currentLatencyMs)} / {region.currentStatusCode ?? 'n/a'}</strong>
                                  </div>
                                  <div>
                                    <span>Compared</span>
                                    <strong>{formatTiming(region.previousLatencyMs)} / {region.previousStatusCode ?? 'n/a'}</strong>
                                  </div>
                                  <div>
                                    <span>Delta</span>
                                    <strong>
                                      {#if region.latencyDeltaMs != null}
                                        {region.latencyDeltaMs > 0 ? '+' : ''}{region.latencyDeltaMs} ms
                                      {:else}
                                        n/a
                                      {/if}
                                    </strong>
                                  </div>
                                  <div>
                                    <span>Final URLs</span>
                                    <strong>{formatText(region.currentFinalUrl)} -> {formatText(region.previousFinalUrl)}</strong>
                                  </div>
                                  <div>
                                    <span>Impl</span>
                                    <strong>{formatText(region.currentProbeImpl)} -> {formatText(region.previousProbeImpl)}</strong>
                                  </div>
                                  <div>
                                    <span>Errors</span>
                                    <strong>{formatText(region.currentErrorMessage)} -> {formatText(region.previousErrorMessage)}</strong>
                                  </div>
                                </div>
                              </div>
                            {/each}
                          </div>
                        </div>
                      {/each}
                    </div>
                  </section>
                {/each}
              </div>
            {:else}
              <p class="hint">Run this profile at least twice to unlock latest-vs-previous comparison.</p>
            {/if}

            {#if getRecentRunDetails(profile.id).length > 0}
              <div class="run-detail-list">
                {#each getRecentRunDetails(profile.id) as runDetail (runDetail.run.id)}
                  <div class="run-detail-card">
                    <div class="run-detail-head">
                      <div>
                        <strong>{runDetail.run.trigger}</strong>
                        <small>{formatDateTime(runDetail.run.createdAt)}</small>
                      </div>
                      <div class="saved-actions">
                        {#if isBaselineRun(profile, runDetail.run.id)}
                          <button class="ghost-button" type="button" onclick={() => clearBaseline(profile.id)} disabled={baselineActionProfileId === profile.id}>
                            {#if baselineActionProfileId === profile.id}Clearing...{:else}Clear baseline{/if}
                          </button>
                        {:else}
                          <button class="ghost-button" type="button" onclick={() => pinBaseline(profile.id, runDetail.run.id)} disabled={baselineActionProfileId === profile.id}>
                            {#if baselineActionProfileId === profile.id}Pinning...{:else}Pin baseline{/if}
                          </button>
                        {/if}
                      </div>
                    </div>

                    <div class="recent-runs">
                      <div>
                        <span>Run id</span>
                        <strong>{runDetail.run.id}</strong>
                      </div>
                      <div>
                        <span>Routes</span>
                        <strong>{runDetail.run.routeCount}</strong>
                      </div>
                      <div>
                        <span>Jobs</span>
                        <strong>{runDetail.jobs.length}</strong>
                      </div>
                      <div>
                        <span>Baseline</span>
                        <strong>{isBaselineRun(profile, runDetail.run.id) ? 'pinned' : 'candidate'}</strong>
                      </div>
                      <div>
                        <span>Monitor</span>
                        <strong>{runDetail.run.evaluation?.status ?? 'pending'}</strong>
                      </div>
                      <div>
                        <span>Alerts</span>
                        <strong>{runDetail.run.alertDeliveries.length}</strong>
                      </div>
                    </div>

                    <div class="run-route-grid">
                      {#each runDetail.jobs as runJob (runJob.id)}
                        <div class="run-route-card">
                          <div>
                            <strong>{runJob.note ?? runJob.url}</strong>
                            <small>{runJob.url}</small>
                          </div>
                          <div class="run-target-grid">
                            {#each runJob.targets as target (target.region)}
                              <div>
                                <span>{target.region}</span>
                                <strong>{target.status} · {formatTiming(target.latencyMs)}</strong>
                              </div>
                            {/each}
                          </div>
                        </div>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </article>
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
</section>

<section class="regions-section" id="regions">
  <div class="section-heading">
    <p class="eyebrow">Execution regions</p>
    <h2>Reference the active corridor, then widen it only when the self-host footprint is ready.</h2>
  </div>

  <div class="continents">
    {#each groupedRegions as group (group.continent)}
      <article class="continent-card">
        <header>
          <h3>{group.continent}</h3>
          <small>{group.regions.length} regions</small>
        </header>

        <div class="region-list">
          {#each group.regions as region (region.code)}
            <button
              class:selected={selectedRegions.includes(region.code)}
              class:disabled={!region.selectable}
              type="button"
              onclick={() => toggleRegion(region)}
            >
              <strong>{region.label}</strong>
              <span>{region.launchStage === 'core' ? 'launch active' : 'catalog only'}</span>
            </button>
          {/each}
        </div>
      </article>
    {/each}
  </div>
</section>

<style>
  section {
    display: grid;
    gap: 22px;
  }

  .hero {
    grid-template-columns: minmax(0, 1fr) minmax(340px, 0.72fr);
    align-items: start;
    gap: 20px;
  }

  .hero-copy,
  .control-card,
  .continent-card,
  .job-summary,
  .result-card,
  .builder-card,
  .saved-card,
  .saved-summary,
  .empty-state {
    border: 1px solid rgba(173, 192, 207, 0.14);
    border-radius: 28px;
    background: rgba(10, 20, 32, 0.72);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.22);
  }

  .hero-copy,
  .control-card,
  .continent-card,
  .job-summary,
  .result-card,
  .builder-card,
  .saved-card,
  .saved-summary,
  .empty-state {
    padding: 28px;
  }

  .hero-copy {
    min-height: 100%;
    display: grid;
    align-content: start;
    gap: 18px;
  }

  .eyebrow,
  .section-heading p,
  .job-summary span,
  .result-head span,
  dt {
    color: #adc0cf;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-size: 0.72rem;
  }

  h1,
  h2,
  h3,
  p,
  strong,
  small {
    margin: 0;
  }

  h1 {
    margin-top: 6px;
    max-width: 9.5ch;
    font-size: clamp(2.5rem, 4.2vw, 4.4rem);
    line-height: 0.97;
  }

  h2 {
    font-size: 1.45rem;
    line-height: 1.15;
  }

  .lede,
  .hint,
  .empty-state small,
  .result-card dd {
    color: #e3e8ed;
    line-height: 1.7;
  }

  .hero-metrics,
  .job-summary,
  .saved-summary,
  .saved-stats,
  .comparison-summary,
  .recent-runs {
    display: grid;
    gap: 14px;
  }

  .hero-metrics {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-top: 4px;
  }

  .hero-metrics div,
  .job-summary div {
    display: grid;
    gap: 6px;
  }

  .hero-metrics div {
    padding-top: 12px;
    border-top: 1px solid rgba(173, 192, 207, 0.14);
  }

  .hero-metrics small,
  .card-copy,
  .setup-flow small {
    color: #adc0cf;
    line-height: 1.55;
  }

  .measurement-details {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 14px;
    margin-top: 18px;
    padding-top: 18px;
    border-top: 1px solid rgba(173, 192, 207, 0.14);
  }

  .measurement-details div {
    display: grid;
    gap: 6px;
  }

  .measurement-details span {
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(214, 225, 234, 0.58);
  }

  .measurement-details strong {
    word-break: break-word;
  }

  .control-card {
    display: grid;
    gap: 16px;
    background: linear-gradient(180deg, rgba(12, 24, 38, 0.98) 0%, rgba(22, 43, 59, 0.96) 100%);
  }

  .card-intro {
    display: grid;
    gap: 8px;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(173, 192, 207, 0.14);
  }

  .card-intro h2 {
    font-size: 1.32rem;
  }

  .field {
    display: grid;
    gap: 8px;
  }

  .grow {
    flex: 1 1 240px;
  }

  .inline-field {
    min-width: 120px;
  }

  .field span {
    color: #adc0cf;
    font-size: 0.82rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .field input,
  .field select,
  .field textarea {
    border: 1px solid rgba(173, 192, 207, 0.22);
    border-radius: 16px;
    background: rgba(6, 12, 20, 0.54);
    color: #f6f4ef;
    padding: 14px 16px;
    font: inherit;
  }

  .field textarea {
    resize: vertical;
    min-height: 96px;
  }

  .checkbox-field {
    display: flex;
    gap: 10px;
    align-items: center;
    color: #f6f4ef;
  }

  .checkbox-list {
    display: grid;
    gap: 8px;
  }

  .submit {
    border: 0;
    border-radius: 999px;
    background: linear-gradient(135deg, #ff784f 0%, #ffb05f 100%);
    color: #101820;
    font: inherit;
    font-weight: 700;
    padding: 14px 18px;
    cursor: pointer;
  }

  .submit:disabled {
    opacity: 0.65;
    cursor: wait;
  }

  .advanced-panel {
    display: grid;
    gap: 14px;
    padding: 14px 16px;
    border: 1px solid rgba(173, 192, 207, 0.16);
    border-radius: 20px;
    background: rgba(255, 255, 255, 0.03);
  }

  .advanced-panel summary {
    cursor: pointer;
    color: #f6f4ef;
    font-weight: 700;
  }

  .advanced-grid {
    display: grid;
    gap: 16px;
    padding-top: 8px;
  }

  .continents,
  .result-grid,
  .builder-grid,
  .saved-grid {
    display: grid;
    gap: 18px;
  }

  .continents {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .continent-card {
    display: grid;
    gap: 18px;
  }

  .continent-card header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: baseline;
  }

  .region-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .region-list button {
    display: grid;
    gap: 4px;
    text-align: left;
    padding: 14px;
    border-radius: 18px;
    border: 1px solid rgba(173, 192, 207, 0.16);
    background: rgba(255, 255, 255, 0.03);
    color: inherit;
    cursor: pointer;
  }

  .region-list button.selected {
    border-color: rgba(255, 120, 79, 0.52);
    background: rgba(255, 120, 79, 0.12);
  }

  .region-list button.disabled {
    opacity: 0.58;
  }

  .region-list button span {
    color: #adc0cf;
    font-size: 0.82rem;
  }

  .job-summary {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .result-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .saved-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .builder-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .result-card {
    display: grid;
    gap: 14px;
  }

  .saved-card {
    display: grid;
    gap: 16px;
  }

  .builder-card {
    display: grid;
    gap: 16px;
  }

  .builder-card h3 {
    font-size: 1.1rem;
  }

  .saved-head {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: start;
  }

  .saved-meta,
  .saved-note,
  .comparison-route small {
    color: #adc0cf;
    line-height: 1.6;
  }

  .saved-stats,
  .comparison-summary,
  .recent-runs {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .saved-stats div,
  .comparison-summary div,
  .recent-runs div {
    display: grid;
    gap: 6px;
  }

  .setup-flow {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .comparison-section-list,
  .run-detail-list {
    display: grid;
    gap: 16px;
  }

  .comparison-block,
  .run-detail-card,
  .run-route-card {
    display: grid;
    gap: 14px;
    padding-top: 14px;
    border-top: 1px solid rgba(173, 192, 207, 0.14);
  }

  .comparison-heading,
  .run-detail-head {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: start;
  }

  .comparison-mode {
    color: #adc0cf;
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .builder-actions,
  .saved-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .list-toolbar,
  .pagination-bar {
    display: flex;
    gap: 12px;
    align-items: end;
    justify-content: space-between;
    flex-wrap: wrap;
  }

  .secondary-button {
    border: 1px solid rgba(173, 192, 207, 0.2);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.04);
    color: #f6f4ef;
    font: inherit;
    padding: 10px 14px;
    cursor: pointer;
  }

  .ghost-button,
  .danger-button {
    border-radius: 999px;
    font: inherit;
    padding: 10px 14px;
    cursor: pointer;
  }

  .ghost-button {
    border: 1px solid rgba(173, 192, 207, 0.16);
    background: transparent;
    color: #adc0cf;
  }

  .danger-button {
    border: 1px solid rgba(255, 120, 79, 0.24);
    background: rgba(255, 120, 79, 0.08);
    color: #ffcfbc;
  }

  .secondary-button:disabled {
    opacity: 0.65;
    cursor: wait;
  }

  .ghost-button:disabled,
  .danger-button:disabled {
    opacity: 0.65;
    cursor: wait;
  }

  select,
  textarea {
    border: 1px solid rgba(173, 192, 207, 0.22);
    border-radius: 16px;
    background: rgba(6, 12, 20, 0.54);
    color: #f6f4ef;
    padding: 14px 16px;
    font: inherit;
  }

  textarea {
    resize: vertical;
    min-height: 110px;
  }

  .pill-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .pill-button {
    padding: 10px 12px;
    border-radius: 999px;
    border: 1px solid rgba(173, 192, 207, 0.16);
    background: rgba(255, 255, 255, 0.03);
    color: inherit;
    cursor: pointer;
  }

  .pill-button.selected {
    border-color: rgba(255, 120, 79, 0.52);
    background: rgba(255, 120, 79, 0.12);
  }

  .comparison-routes {
    display: grid;
    gap: 12px;
  }

  .comparison-region-grid,
  .run-route-grid,
  .run-target-grid {
    display: grid;
    gap: 12px;
  }

  .comparison-region-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  .comparison-route {
    display: grid;
    gap: 10px;
    padding-top: 14px;
    border-top: 1px solid rgba(173, 192, 207, 0.14);
  }

  .comparison-region-card {
    display: grid;
    gap: 10px;
    padding: 14px;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(173, 192, 207, 0.1);
  }

  .comparison-region-card.improved {
    border-color: rgba(80, 201, 164, 0.24);
  }

  .comparison-region-card.regressed {
    border-color: rgba(255, 120, 79, 0.24);
  }

  .comparison-region-head {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    align-items: baseline;
  }

  .comparison-region-stats,
  .run-target-grid {
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  }

  .comparison-region-stats div,
  .run-target-grid div {
    display: grid;
    gap: 6px;
  }

  .comparison-region-stats span,
  .run-target-grid span {
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(214, 225, 234, 0.58);
  }

  .result-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: baseline;
  }

  dl {
    display: grid;
    gap: 12px;
    margin: 0;
  }

  dl div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  dt,
  dd {
    margin: 0;
  }

  .error {
    color: #ffd1bf;
    line-height: 1.6;
  }

  .empty-state {
    place-items: center;
    text-align: center;
    min-height: 220px;
  }

  .turnstile-shell {
    overflow: auto;
  }

  @media (max-width: 940px) {
    .hero,
    .continents,
    .result-grid,
    .builder-grid,
    .saved-grid,
    .job-summary,
    .saved-stats,
    .comparison-summary,
    .recent-runs,
    .saved-summary {
      grid-template-columns: 1fr;
    }

    .hero-metrics,
    .region-list {
      grid-template-columns: 1fr;
    }
  }
</style>
