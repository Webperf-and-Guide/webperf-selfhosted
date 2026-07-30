import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type UpgradeManifest = {
  schemaVersion: 1;
  siteId: string;
  routeGroupId: string;
  checkId: string;
  jobId: string;
  sourceRegions: ['tokyo', 'singapore'];
};

const requireArgument = (index: number, label: string) => {
  const value = process.argv[index]?.trim();
  if (!value) {
    throw new Error(`Missing ${label}`);
  }
  return value;
};

const requireEnvironment = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
};

const parseBaseUrl = (raw: string) => {
  const url = new URL(raw);
  if (
    url.protocol !== 'http:'
    || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' && url.hostname !== '::1')
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
  ) {
    throw new Error('Upgrade fixture base URL must be a credential-free loopback HTTP origin');
  }
  return url.origin;
};

const requireObject = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

const requireString = (value: unknown, label: string) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
};

const requestJson = async (
  baseUrl: string,
  token: string,
  path: string,
  init: RequestInit = {}
) => {
  const response = await request(baseUrl, token, path, init);
  const body = await response.text();
  let payload: unknown;
  try {
    payload = body ? JSON.parse(body) : null;
  } catch {
    throw new Error(`${init.method ?? 'GET'} ${path} returned invalid JSON (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${path} failed with ${response.status}: ${JSON.stringify(payload).slice(0, 2_048)}`
    );
  }
  return payload;
};

const request = async (
  baseUrl: string,
  token: string,
  path: string,
  init: RequestInit = {}
) => {
  try {
    return await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...init.headers
      },
      signal: init.signal ?? AbortSignal.timeout(20_000)
    });
  } catch (error) {
    throw new Error(`${init.method ?? 'GET'} ${path} transport failed`, {
      cause: error instanceof Error ? error : undefined
    });
  }
};

const postJson = (
  baseUrl: string,
  token: string,
  path: string,
  body: Record<string, unknown>
) => requestJson(baseUrl, token, path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
});

const seedLegacy = async (
  baseUrl: string,
  token: string,
  manifestPath: string
) => {
  const siteResponse = requireObject(
    await postJson(baseUrl, token, '/v1/properties', {
      name: 'Upgrade drill site',
      baseUrl: 'https://example.com/'
    }),
    'site response'
  );
  const site = requireObject(siteResponse.property, 'site response.property');
  const siteId = requireString(site.id, 'site.id');

  const routeGroupResponse = requireObject(
    await postJson(baseUrl, token, '/v1/route-sets', {
      propertyId: siteId,
      name: 'Upgrade drill routes',
      routes: [{ label: 'Homepage', url: 'https://example.com/' }]
    }),
    'route group response'
  );
  const routeGroup = requireObject(routeGroupResponse.routeSet, 'route group response.routeSet');
  const routeGroupId = requireString(routeGroup.id, 'routeGroup.id');

  const regionPackResponse = requireObject(
    await postJson(baseUrl, token, '/v1/region-packs', {
      name: 'Legacy APAC pair',
      regions: ['tokyo', 'singapore']
    }),
    'region pack response'
  );
  const regionPack = requireObject(regionPackResponse.regionPack, 'region pack response.regionPack');
  const regionPackId = requireString(regionPack.id, 'regionPack.id');

  const checkResponse = requireObject(
    await postJson(baseUrl, token, '/v1/check-profiles', {
      propertyId: siteId,
      routeSetId: routeGroupId,
      regionPackId,
      name: 'Legacy scheduled global check',
      note: 'must require explicit single-region review',
      scheduleIntervalMinutes: 60
    }),
    'check response'
  );
  const check = requireObject(checkResponse.profile, 'check response.profile');
  const checkId = requireString(check.id, 'check.id');

  const jobResponse = requireObject(
    await postJson(baseUrl, token, '/v1/jobs', {
      url: 'https://example.com/',
      regions: ['tokyo', 'singapore'],
      note: 'legacy multi-region upgrade evidence'
    }),
    'job response'
  );
  const job = requireObject(jobResponse.job, 'job response.job');
  const jobId = requireString(job.id, 'job.id');

  const manifest: UpgradeManifest = {
    schemaVersion: 1,
    siteId,
    routeGroupId,
    checkId,
    jobId,
    sourceRegions: ['tokyo', 'singapore']
  };
  const destination = resolve(manifestPath);
  await writeFile(destination, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx'
  });
  console.log(JSON.stringify({ ok: true, command: 'seed-legacy', manifest }));
};

const parseManifest = async (path: string): Promise<UpgradeManifest> => {
  const manifestPath = resolve(path);
  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(await Bun.file(manifestPath).text());
  } catch (error) {
    throw new Error(
      `Unable to parse upgrade manifest ${manifestPath}: ${
        error instanceof Error ? error.message : 'unknown error'
      }`
    );
  }
  const payload = requireObject(rawPayload, 'upgrade manifest');
  if (payload.schemaVersion !== 1) {
    throw new Error('Upgrade manifest schemaVersion must be 1');
  }
  const sourceRegions = payload.sourceRegions;
  if (
    !Array.isArray(sourceRegions)
    || sourceRegions.length !== 2
    || sourceRegions[0] !== 'tokyo'
    || sourceRegions[1] !== 'singapore'
  ) {
    throw new Error('Upgrade manifest source regions changed');
  }
  return {
    schemaVersion: 1,
    siteId: requireString(payload.siteId, 'manifest.siteId'),
    routeGroupId: requireString(payload.routeGroupId, 'manifest.routeGroupId'),
    checkId: requireString(payload.checkId, 'manifest.checkId'),
    jobId: requireString(payload.jobId, 'manifest.jobId'),
    sourceRegions: ['tokyo', 'singapore']
  };
};

const verifyCurrent = async (
  baseUrl: string,
  token: string,
  manifestPath: string
) => {
  const manifest = await parseManifest(manifestPath);
  const job = requireObject(
    await requestJson(baseUrl, token, `/v1/jobs/${encodeURIComponent(manifest.jobId)}`),
    'migrated job'
  );
  if (job.region !== 'historical-multi-region') {
    throw new Error('Migrated multi-region Job lost its explicit aggregate identity');
  }
  if (JSON.stringify(job.historicalRegions) !== JSON.stringify(manifest.sourceRegions)) {
    throw new Error('Migrated Job lost its historical region list');
  }
  const targets = Array.isArray(job.targets) ? job.targets : [];
  const targetRegions = targets
    .map((target) => requireObject(target, 'job target').region)
    .filter((region): region is string => typeof region === 'string')
    .sort();
  if (JSON.stringify(targetRegions) !== JSON.stringify([...manifest.sourceRegions].sort())) {
    throw new Error('Migrated Job target provenance changed');
  }

  const check = requireObject(
    await requestJson(
      baseUrl,
      token,
      `/v1/check-profiles/${encodeURIComponent(manifest.checkId)}`
    ),
    'migrated check'
  );
  if (check.schedule !== null) {
    throw new Error('Migrated multi-region Check schedule must be disabled');
  }
  const migration = requireObject(check.locationMigration, 'check.locationMigration');
  if (
    migration.status !== 'requires_review'
    || migration.reason !== 'legacy_multi_region'
    || JSON.stringify(migration.sourceRegions) !== JSON.stringify(manifest.sourceRegions)
    || migration.runtimeRegionId !== 'tokyo'
  ) {
    throw new Error('Migrated Check did not preserve its explicit review state');
  }

  const blockedRun = await request(
    baseUrl,
    token,
    `/v1/check-profiles/${encodeURIComponent(manifest.checkId)}/runs`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: '{}',
      signal: AbortSignal.timeout(20_000)
    }
  );
  await blockedRun.body?.cancel();
  if (blockedRun.status !== 409) {
    throw new Error(`Migrated Check must reject execution before review (got ${blockedRun.status})`);
  }

  const acceptedResponse = requireObject(
    await requestJson(
      baseUrl,
      token,
      `/v1/check-profiles/${encodeURIComponent(manifest.checkId)}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          propertyId: manifest.siteId,
          routeSetId: manifest.routeGroupId,
          name: requireString(check.name, 'check.name'),
          note: typeof check.note === 'string' ? check.note : undefined,
          acknowledgeLocationMigration: true
        })
      }
    ),
    'acknowledged check response'
  );
  const acceptedCheck = requireObject(acceptedResponse.profile, 'acknowledged check');
  const acceptedMigration = requireObject(
    acceptedCheck.locationMigration,
    'acknowledged check.locationMigration'
  );
  if (acceptedMigration.status !== 'accepted' || typeof acceptedMigration.acknowledgedAt !== 'string') {
    throw new Error('Migrated Check acknowledgement was not persisted');
  }

  const removedRegionSets = await request(baseUrl, token, '/v1/region-sets');
  await removedRegionSets.body?.cancel();
  if (removedRegionSets.status !== 410) {
    throw new Error(`Retired Region Set endpoint must return 410 (got ${removedRegionSets.status})`);
  }

  console.log(JSON.stringify({
    ok: true,
    command: 'verify-current',
    jobId: manifest.jobId,
    checkId: manifest.checkId,
    historicalRegions: manifest.sourceRegions,
    migrationStatus: acceptedMigration.status
  }));
};

const command = requireArgument(2, 'command');
const baseUrl = parseBaseUrl(requireArgument(3, 'base URL'));
const manifestPath = requireArgument(4, 'manifest path');
const token = requireEnvironment('WEBPERF_UPGRADE_ADMIN_TOKEN');

switch (command) {
  case 'seed-legacy':
    await seedLegacy(baseUrl, token, manifestPath);
    break;
  case 'verify-current':
    await verifyCurrent(baseUrl, token, manifestPath);
    break;
  default:
    throw new Error(`Unknown upgrade fixture command: ${command}`);
}
