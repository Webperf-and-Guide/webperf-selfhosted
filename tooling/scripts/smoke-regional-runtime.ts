import {
  regionalExecutionResultSchema,
  regionalRuntimeCapabilitiesSchema,
  type RegionalExecutionRequest
} from '@webperf/contracts';
import {
  createRegionalExecutionSignature,
  verifyRegionalResultSignature
} from '@webperf/domain-core';
import { randomUUID } from 'node:crypto';

const baseUrl = requiredEnvironment('REGIONAL_RUNTIME_BASE_URL').replace(/\/$/, '');
const sharedSecret = requiredEnvironment('REGIONAL_RUNTIME_SHARED_SECRET');
const expectedRegion = requiredEnvironment('REGIONAL_RUNTIME_EXPECTED_REGION');
const idempotencyKey = `smoke_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
const unsignedRequest = {
  idempotencyKey,
  runnerType: 'network_probe',
  targets: [{
    targetId: 'example',
    url: 'https://example.com/',
    request: {
      method: 'GET',
      headers: [],
      body: null
    }
  }],
  deadlineMs: 60_000,
  maxAttempts: 2,
  timestamp: new Date().toISOString(),
  keyVersion: 'current'
} satisfies Omit<RegionalExecutionRequest, 'signature'>;
const authorization = { authorization: `Bearer ${sharedSecret}` };

const capabilitiesResponse = await requestStep(
  'regional capabilities',
  `${baseUrl}/v1/regional-capabilities`,
  { signal: AbortSignal.timeout(5_000) }
);
assert(capabilitiesResponse.ok, 'regional capabilities request failed');
const capabilities = regionalRuntimeCapabilitiesSchema.parse(
  await parseJsonStep('regional capabilities', capabilitiesResponse)
);
assert(capabilities.regionId === expectedRegion, 'regional runtime reported the wrong region');
assert(
  capabilities.runnerTypes.length === 1
    && capabilities.runnerTypes[0] === 'network_probe',
  'regional runtime advertised an unexpected runner surface'
);

const fullSurfaceResponse = await requestStep(
  'restricted surface',
  `${baseUrl}/v1/sites`,
  {
    headers: authorization,
    signal: AbortSignal.timeout(5_000)
  }
);
assert(fullSurfaceResponse.status === 404, 'regional mode exposed the full self-host API');

const createResponse = await requestStep(
  'regional execution creation',
  `${baseUrl}/v1/regional-executions`,
  {
    method: 'POST',
    headers: {
      ...authorization,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      ...unsignedRequest,
      signature: await createRegionalExecutionSignature(sharedSecret, unsignedRequest)
    }),
    signal: AbortSignal.timeout(10_000)
  }
);
assert(createResponse.status === 202, `regional execution returned ${createResponse.status}`);
await verifySignedResult(
  await parseJsonStep('regional execution creation', createResponse)
);

const deadline = Date.now() + 90_000;
let status = 'queued';
let pollIntervalMs = 250;
while (Date.now() < deadline) {
  const response = await requestStep(
    'regional execution poll',
    `${baseUrl}/v1/regional-executions/${encodeURIComponent(idempotencyKey)}`,
    {
      headers: authorization,
      signal: AbortSignal.timeout(10_000)
    }
  );
  assert(response.ok, `regional execution poll returned ${response.status}`);
  const result = await verifySignedResult(
    await parseJsonStep('regional execution poll', response)
  );
  status = result.status;
  if (status === 'succeeded') {
    const target = result.targets[0];
    assert(target?.status === 'succeeded', 'regional target did not succeed');
    assert(target.region === expectedRegion, 'regional target provenance drifted');
    console.log(JSON.stringify({
      ok: true,
      regionId: expectedRegion,
      status,
      latencyMs: target.latencyMs
    }));
    process.exit(0);
  }
  if (status === 'failed' || status === 'cancelled') {
    throw new Error(`regional execution reached unexpected terminal status ${status}`);
  }
  await Bun.sleep(pollIntervalMs);
  const jitterMs = Math.floor(Math.random() * 100);
  pollIntervalMs = Math.min(Math.round(pollIntervalMs * 1.5) + jitterMs, 3_000);
}

throw new Error(`regional execution did not finish before the smoke deadline (last status ${status})`);

async function requestStep(
  step: string,
  url: string,
  init: RequestInit
) {
  try {
    return await fetch(url, init);
  } catch (cause) {
    throw new Error(`${step} request failed`, { cause });
  }
}

async function parseJsonStep(step: string, response: Response) {
  try {
    return await response.json();
  } catch (cause) {
    throw new Error(`${step} returned invalid JSON`, { cause });
  }
}

async function verifySignedResult(value: unknown) {
  const result = regionalExecutionResultSchema.parse(value);
  const { signature, ...unsigned } = result;
  assert(result.keyVersion === 'current', 'smoke result used an unexpected signing key');
  assert(
    await verifyRegionalResultSignature(sharedSecret, unsigned, signature),
    'regional result signature verification failed'
  );
  return result;
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
