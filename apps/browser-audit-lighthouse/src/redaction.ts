import type { BrowserAuditWorkerRequest } from '@webperf/contracts';

const redactedValue = '[REDACTED]';

export const redactBrowserAuditText = (value: string, input: BrowserAuditWorkerRequest) => {
  let redacted = value;
  const sensitiveValues = [
    ...input.customHeaders.map((header) => header.value),
    ...input.cookies.map((cookie) => cookie.value),
    input.artifactUpload?.bearerToken
  ]
    .filter((candidate): candidate is string => Boolean(candidate))
    .sort((left, right) => right.length - left.length);

  for (const sensitiveValue of sensitiveValues) {
    redacted = redacted.replaceAll(sensitiveValue, redactedValue);
  }

  return redacted.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => {
    try {
      const url = new URL(candidate);
      if (url.search.length > 0) {
        url.search = '?redacted';
      }
      url.hash = '';
      return url.toString();
    } catch {
      return candidate;
    }
  });
};
