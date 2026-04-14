import type { BrowserAuditWorkerRequest } from '@webperf/contracts';

const normalizeHeaders = (headers: BrowserAuditWorkerRequest['customHeaders']) =>
  [...headers]
    .filter((header) => header.name.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name) || left.value.localeCompare(right.value));

const normalizeCookies = (cookies: BrowserAuditWorkerRequest['cookies']) =>
  [...cookies].sort((left, right) => left.name.localeCompare(right.name) || left.value.localeCompare(right.value));

export const toBrowserAuditSignaturePayload = (request: BrowserAuditWorkerRequest) =>
  JSON.stringify({
    executionId: request.executionId,
    targetUrl: request.targetUrl,
    region: request.region,
    policy: request.policy,
    customHeaders: normalizeHeaders(request.customHeaders),
    cookies: normalizeCookies(request.cookies),
    artifactUpload:
      request.artifactUpload == null
        ? null
        : {
            baseUrl: request.artifactUpload.baseUrl
          },
    timestamp: request.timestamp,
    keyVersion: request.keyVersion
  });

export const createBrowserAuditSignature = async (
  sharedSecret: string,
  request: BrowserAuditWorkerRequest
) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(sharedSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(toBrowserAuditSignaturePayload(request))
  );

  return [...new Uint8Array(signature)].map((value) => value.toString(16).padStart(2, '0')).join('');
};

export const verifyBrowserAuditSignature = async (
  sharedSecret: string | undefined,
  request: BrowserAuditWorkerRequest
) => {
  if (!sharedSecret) {
    return false;
  }

  const expected = await createBrowserAuditSignature(sharedSecret, request);
  return constantTimeEqual(expected, request.signature);
};

const constantTimeEqual = (left: string, right: string) => {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);

  if (leftBytes.byteLength !== rightBytes.byteLength) {
    return false;
  }

  let diff = 0;

  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    diff |= leftBytes[index]! ^ rightBytes[index]!;
  }

  return diff === 0;
};
