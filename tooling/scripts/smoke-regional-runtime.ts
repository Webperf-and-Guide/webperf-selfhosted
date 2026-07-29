import {
  regionalExecutionResultSchema,
  type RegionalExecutionRequest
} from '@webperf/contracts';
import {
  createRegionalExecutionSignature,
  verifyRegionalResultSignature
} from '@webperf/domain-core';

const baseUrl = requiredEnvironment('REGIONAL_RUNTIME_BASE_URL').replace(/\/$/, '');
const sharedSecret = requiredEnvironment('REGIONAL_RUNTIME_SHARED_SECRET');
const expectedRegion = requiredEnvironment('REGIONAL_RUNTIME_EXPECTED_REGION');
const idempotencyKey = `smoke_${Date.now().toString(36)}`;
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

const capabilitiesResponse = await fetch(`${baseUrl}/v1/regional-capabilities`, {
  signal: AbortSignal.timeout(5_000)
});
assert(capabilitiesResponse.ok, 'regional capabilities request failed');
const capabilities = await capabilitiesResponse.json() as {
  protocolVersion?: number;
  regionId?: string;
  runnerTypes?: string[];
};
assert(capabilities.protocolVersion === 1, 'unexpected regional protocol version');
assert(capabilities.regionId === expectedRegion, 'regional runtime reported the wrong region');
assert(
  capabilities.runnerTypes?.length === 1
    && capabilities.runnerTypes[0] === 'network_probe',
  'regional runtime advertised an unexpected runner surface'
);

const fullSurfaceResponse = await fetch(`${baseUrl}/v1/sites`, {
  headers: authorization,
  signal: AbortSignal.timeout(5_000)
});
assert(fullSurfaceResponse.status === 404, 'regional mode exposed the full self-host API');

const createResponse = await fetch(`${baseUrl}/v1/regional-executions`, {
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
});
assert(createResponse.status === 202, `regional execution returned ${createResponse.status}`);
await verifySignedResult(await createResponse.json());

const deadline = Date.now() + 90_000;
let status = 'queued';
while (Date.now() < deadline) {
  const response = await fetch(
    `${baseUrl}/v1/regional-executions/${encodeURIComponent(idempotencyKey)}`,
    {
      headers: authorization,
      signal: AbortSignal.timeout(10_000)
    }
  );
  assert(response.ok, `regional execution poll returned ${response.status}`);
  const result = await verifySignedResult(await response.json());
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
  await Bun.sleep(500);
}

throw new Error(`regional execution did not finish before the smoke deadline (last status ${status})`);

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
