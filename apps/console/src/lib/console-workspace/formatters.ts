import type {
  CheckProfile,
  CheckProfileComparisonResponse,
  CheckProfileLatestComparisonResponse,
  LatencyJobDetail,
  RegionAvailability,
  RequestHeader
} from '@webperf/contracts';
import type { ComparisonSection } from '$lib/console-view';

export const CONSOLE_COLLECTION_PAGE_SIZE = 100;
export const CONSOLE_RUN_PAGE_SIZE = 10;
export const CONSOLE_RECENT_RUN_COUNT = 3;
export const MAX_SELECTABLE_REGIONS = 4;

export const groupRegions = (regions: RegionAvailability[]) => {
  const continents = Array.from(new Set(regions.map((region) => region.continent)));

  return continents.map((continent) => ({
    continent,
    regions: regions.filter((region) => region.continent === continent)
  }));
};

export const formatTiming = (value: number | null | undefined) =>
  value == null ? 'n/a' : `${value} ms`;

export const formatText = (value: string | null | undefined) => value ?? 'n/a';

export const formatDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : 'n/a';

export const formatPercentScore = (value: number | null | undefined) =>
  value == null ? 'n/a' : `${Math.round(value * 100)} / 100`;

export const formatSchedule = (minutes: number | null | undefined) =>
  minutes == null ? 'manual only' : `every ${minutes} min`;

export const parseRouteEntries = (value: string) => {
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

export const parseHeaderEntries = (value: string): RequestHeader[] =>
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

export const buildRequestConfig = (
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

export const stringifyHeaders = (headers: RequestHeader[]) =>
  headers.map((header) => `${header.name}: ${header.value}`).join('\n');

export const parseWebhookTargets = (value: string) =>
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

export const stringifyWebhookTargets = (
  targets: NonNullable<CheckProfile['alerts']>['webhookTargets']
) => targets.map((target) => [target.name, target.url, target.secret ?? ''].join(' | ')).join('\n');

export const formatRequestConfig = (request: CheckProfile['request'] | LatencyJobDetail['request']) => {
  if (!request) {
    return 'GET';
  }

  const headerCount = request.headers?.length ?? 0;
  return `${request.method} · ${headerCount} headers · ${request.body ? 'body' : 'no body'}`;
};

export const formatMonitorSummary = (profile: CheckProfile) => {
  const monitorType = profile.monitorPolicy?.monitorType ?? 'latency';
  const threshold = profile.monitorPolicy?.latencyThresholdMs;
  return threshold ? `${monitorType} · threshold ${threshold} ms` : `${monitorType} · no threshold`;
};

export const formatAlertSummary = (profile: CheckProfile) => {
  if (!profile.alerts?.enabled || (profile.alerts.webhookTargets?.length ?? 0) === 0) {
    return 'alerts off';
  }

  return `${profile.alerts.webhookTargets.length} webhook${
    profile.alerts.webhookTargets.length > 1 ? 's' : ''
  }`;
};

export const buildComparisonSections = (
  latestComparison: CheckProfileLatestComparisonResponse | null,
  baselineComparison: CheckProfileComparisonResponse | null
): ComparisonSection[] => {
  const sections: ComparisonSection[] = [];

  if (latestComparison) {
    sections.push({
      id: 'latest',
      title: 'Latest vs previous',
      subtitle: 'Auto-compares the newest run against the one before it.',
      comparison: latestComparison
    });
  }

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
