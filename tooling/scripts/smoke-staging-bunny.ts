const baseUrl = process.env.EDGE_CONTROL_BASE_URL;
const opsSecret = process.env.OPS_SHARED_SECRET;
const smokeRegion = process.env.SMOKE_REGION ?? 'tokyo';
const smokeUrl = process.env.SMOKE_URL ?? 'https://example.com';

if (!baseUrl) {
  throw new Error('EDGE_CONTROL_BASE_URL is required');
}

if (!opsSecret) {
  throw new Error('OPS_SHARED_SECRET is required');
}

const response = await fetch(new URL('/internal/smoke/bunny', baseUrl).toString(), {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-ops-shared-secret': opsSecret
  },
  body: JSON.stringify({
    region: smokeRegion,
    url: smokeUrl
  })
});

const payload = await response.text();

if (!response.ok) {
  console.error(payload);
  process.exit(1);
}

console.log(payload);
