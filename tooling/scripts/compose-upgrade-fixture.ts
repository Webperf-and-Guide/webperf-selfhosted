import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const fixture = {
  runtimeRegionId: 'upgrade-drill',
  siteName: 'Supported upgrade site',
  siteBaseUrl: 'https://example.com/',
  routeGroupName: 'Supported upgrade routes',
  routeLabel: 'Homepage',
  routeUrl: 'https://example.com/',
  checkName: 'Supported upgrade check',
  checkNote: 'must remain runnable after the release upgrade',
  jobUrl: 'https://example.com/',
  jobNote: 'supported baseline upgrade evidence'
} as const;

type UpgradeManifest = {
  schemaVersion: 2;
  siteId: string;
  routeGroupId: string;
  routeId: string;
  checkId: string;
  jobId: string;
  runtimeRegionId: typeof fixture.runtimeRegionId;
};

class UpgradeFixtureTransportError extends Error {}

const REQUEST_TIMEOUT_MS = 20_000;
const JOB_POLL_ATTEMPTS = 180;
const JOB_POLL_INTERVAL_MS = 1_000;

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

const requireArray = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
};

const requireString = (value: unknown, label: string) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
};

const requireExact = (value: unknown, expected: unknown, label: string) => {
  if (value !== expected) {
    throw new Error(`${label} changed across the release upgrade`);
  }
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
      signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw new UpgradeFixtureTransportError(`${init.method ?? 'GET'} ${path} transport failed`, {
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

const waitForSucceededJob = async (
  baseUrl: string,
  token: string,
  jobId: string
) => {
  let lastStatus = 'unknown';
  let lastTransportError: UpgradeFixtureTransportError | undefined;

  // A network measurement may legitimately take a few minutes. Keep the
  // release gate patient enough for a cold Compose runner while bounding each
  // individual request separately so a stalled connection cannot consume the
  // entire polling budget.
  for (let attempt = 0; attempt < JOB_POLL_ATTEMPTS; attempt += 1) {
    try {
      const job = requireObject(
        await requestJson(baseUrl, token, `/v1/jobs/${encodeURIComponent(jobId)}`),
        'job'
      );
      lastStatus = typeof job.status === 'string' ? job.status : 'invalid';

      if (lastStatus === 'succeeded') {
        return job;
      }
      if (lastStatus === 'failed' || lastStatus === 'partial') {
        throw new Error(`Upgrade fixture job ${jobId} reached terminal status ${lastStatus}`);
      }
    } catch (error) {
      if (!(error instanceof UpgradeFixtureTransportError)) {
        throw error;
      }
      lastTransportError = error;
    }

    await Bun.sleep(JOB_POLL_INTERVAL_MS);
  }

  if (lastStatus === 'unknown' && lastTransportError !== undefined) {
    throw new Error(
      `Upgrade fixture job ${jobId} never became reachable: ${lastTransportError.message}`,
      { cause: lastTransportError }
    );
  }

  throw new Error(`Upgrade fixture job ${jobId} timed out in status ${lastStatus}`);
};

const verifySucceededJob = (
  job: Record<string, unknown>,
  jobId: string,
  expectedNote?: string
) => {
  requireExact(job.id, jobId, 'job.id');
  requireExact(job.url, fixture.jobUrl, 'job.url');
  if (expectedNote !== undefined) {
    requireExact(job.note, expectedNote, 'job.note');
  }
  requireExact(job.status, 'succeeded', 'job.status');
  requireExact(job.region, fixture.runtimeRegionId, 'job.region');

  const targets = requireArray(job.targets, 'job.targets');
  if (targets.length !== 1) {
    throw new Error('Upgraded job must retain exactly one runtime target');
  }
  const target = requireObject(targets[0], 'job.targets[0]');
  requireExact(target.jobId, jobId, 'job.targets[0].jobId');
  requireExact(target.region, fixture.runtimeRegionId, 'job.targets[0].region');
  requireExact(target.status, 'succeeded', 'job.targets[0].status');
  requireExact(target.success, true, 'job.targets[0].success');

  const summary = requireObject(job.summary, 'job.summary');
  requireExact(summary.total, 1, 'job.summary.total');
  requireExact(summary.succeeded, 1, 'job.summary.succeeded');
  requireExact(summary.failed, 0, 'job.summary.failed');
  requireExact(summary.inflight, 0, 'job.summary.inflight');
};

const seedBaseline = async (
  baseUrl: string,
  token: string,
  manifestPath: string
) => {
  const siteResponse = requireObject(
    await postJson(baseUrl, token, '/v1/sites', {
      name: fixture.siteName,
      baseUrl: fixture.siteBaseUrl
    }),
    'site response'
  );
  const site = requireObject(siteResponse.site, 'site response.site');
  const siteId = requireString(site.id, 'site.id');

  const routeGroupResponse = requireObject(
    await postJson(baseUrl, token, '/v1/route-groups', {
      propertyId: siteId,
      name: fixture.routeGroupName,
      routes: [{ label: fixture.routeLabel, url: fixture.routeUrl }]
    }),
    'route group response'
  );
  const routeGroup = requireObject(
    routeGroupResponse.routeGroup,
    'route group response.routeGroup'
  );
  const routeGroupId = requireString(routeGroup.id, 'routeGroup.id');
  const routes = requireArray(routeGroup.routes, 'routeGroup.routes');
  if (routes.length !== 1) {
    throw new Error('Baseline route group must contain exactly one route');
  }
  const route = requireObject(routes[0], 'routeGroup.routes[0]');
  const routeId = requireString(route.id, 'route.id');

  const checkResponse = requireObject(
    await postJson(baseUrl, token, '/v1/checks', {
      propertyId: siteId,
      routeSetId: routeGroupId,
      name: fixture.checkName,
      note: fixture.checkNote
    }),
    'check response'
  );
  const check = requireObject(checkResponse.check, 'check response.check');
  const checkId = requireString(check.id, 'check.id');

  const jobResponse = requireObject(
    await postJson(baseUrl, token, '/v1/jobs', {
      url: fixture.jobUrl,
      note: fixture.jobNote
    }),
    'job response'
  );
  const createdJob = requireObject(jobResponse.job, 'job response.job');
  const jobId = requireString(createdJob.id, 'job.id');
  const job = await waitForSucceededJob(baseUrl, token, jobId);
  verifySucceededJob(job, jobId, fixture.jobNote);

  const manifest: UpgradeManifest = {
    schemaVersion: 2,
    siteId,
    routeGroupId,
    routeId,
    checkId,
    jobId,
    runtimeRegionId: fixture.runtimeRegionId
  };
  const destination = resolve(manifestPath);
  await writeFile(destination, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx'
  });
  console.log(JSON.stringify({ ok: true, command: 'seed-baseline', manifest }));
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
  if (payload.schemaVersion !== 2) {
    throw new Error('Upgrade manifest schemaVersion must be 2');
  }
  if (payload.runtimeRegionId !== fixture.runtimeRegionId) {
    throw new Error('Upgrade manifest runtime region changed');
  }
  return {
    schemaVersion: 2,
    siteId: requireString(payload.siteId, 'manifest.siteId'),
    routeGroupId: requireString(payload.routeGroupId, 'manifest.routeGroupId'),
    routeId: requireString(payload.routeId, 'manifest.routeId'),
    checkId: requireString(payload.checkId, 'manifest.checkId'),
    jobId: requireString(payload.jobId, 'manifest.jobId'),
    runtimeRegionId: fixture.runtimeRegionId
  };
};

const verifyCurrent = async (
  baseUrl: string,
  token: string,
  manifestPath: string
) => {
  const manifest = await parseManifest(manifestPath);

  const site = requireObject(
    await requestJson(baseUrl, token, `/v1/sites/${encodeURIComponent(manifest.siteId)}`),
    'upgraded site'
  );
  requireExact(site.id, manifest.siteId, 'site.id');
  requireExact(site.name, fixture.siteName, 'site.name');
  requireExact(site.baseUrl, fixture.siteBaseUrl, 'site.baseUrl');

  const routeGroup = requireObject(
    await requestJson(
      baseUrl,
      token,
      `/v1/route-groups/${encodeURIComponent(manifest.routeGroupId)}`
    ),
    'upgraded route group'
  );
  requireExact(routeGroup.id, manifest.routeGroupId, 'routeGroup.id');
  requireExact(routeGroup.propertyId, manifest.siteId, 'routeGroup.propertyId');
  requireExact(routeGroup.name, fixture.routeGroupName, 'routeGroup.name');
  const routes = requireArray(routeGroup.routes, 'routeGroup.routes');
  if (routes.length !== 1) {
    throw new Error('Upgraded route group must retain exactly one route');
  }
  const route = requireObject(routes[0], 'routeGroup.routes[0]');
  requireExact(route.id, manifest.routeId, 'route.id');
  requireExact(route.label, fixture.routeLabel, 'route.label');
  requireExact(route.url, fixture.routeUrl, 'route.url');

  const check = requireObject(
    await requestJson(baseUrl, token, `/v1/checks/${encodeURIComponent(manifest.checkId)}`),
    'upgraded check'
  );
  requireExact(check.id, manifest.checkId, 'check.id');
  requireExact(check.propertyId, manifest.siteId, 'check.propertyId');
  requireExact(check.routeSetId, manifest.routeGroupId, 'check.routeSetId');
  requireExact(check.name, fixture.checkName, 'check.name');
  requireExact(check.note, fixture.checkNote, 'check.note');
  requireExact(check.locationMigration, null, 'check.locationMigration');

  const baselineJob = requireObject(
    await requestJson(baseUrl, token, `/v1/jobs/${encodeURIComponent(manifest.jobId)}`),
    'upgraded baseline job'
  );
  verifySucceededJob(baselineJob, manifest.jobId, fixture.jobNote);

  const runResponse = requireObject(
    await postJson(
      baseUrl,
      token,
      `/v1/checks/${encodeURIComponent(manifest.checkId)}/runs`,
      {}
    ),
    'post-upgrade check run response'
  );
  const runCheck = requireObject(runResponse.check, 'post-upgrade check run response.check');
  requireExact(runCheck.id, manifest.checkId, 'post-upgrade check.id');
  const runJobs = requireArray(runResponse.jobs, 'post-upgrade check run response.jobs');
  if (runJobs.length !== 1) {
    throw new Error('Post-upgrade Check must create exactly one Job');
  }
  const createdRunJob = requireObject(runJobs[0], 'post-upgrade check run response.jobs[0]');
  const runJobId = requireString(createdRunJob.id, 'post-upgrade job.id');
  const completedRunJob = await waitForSucceededJob(baseUrl, token, runJobId);
  verifySucceededJob(completedRunJob, runJobId);

  const runList = requireObject(
    await requestJson(
      baseUrl,
      token,
      `/v1/checks/${encodeURIComponent(manifest.checkId)}/runs?pageSize=10`
    ),
    'post-upgrade check run list'
  );
  const runs = requireArray(runList.runs, 'post-upgrade check run list.runs');
  const persistedRun = runs.find((candidate) => {
    const run = requireObject(candidate, 'post-upgrade check run');
    const runRoutes = requireArray(run.routes, 'post-upgrade check run.routes');
    return runRoutes.some((routeCandidate) => {
      const runRoute = requireObject(routeCandidate, 'post-upgrade check run route');
      return runRoute.jobId === runJobId;
    });
  });
  if (!persistedRun) {
    throw new Error('Post-upgrade Check run was not persisted');
  }

  console.log(JSON.stringify({
    ok: true,
    command: 'verify-current',
    verification: 'baseline-resource-persistence',
    baselineJobId: manifest.jobId,
    postUpgradeJobId: runJobId,
    runtimeRegionId: manifest.runtimeRegionId
  }));
};

if (import.meta.main) {
  const command = requireArgument(2, 'command');
  const baseUrl = parseBaseUrl(requireArgument(3, 'base URL'));
  const manifestPath = requireArgument(4, 'manifest path');
  const token = requireEnvironment('WEBPERF_UPGRADE_ADMIN_TOKEN');

  switch (command) {
    case 'seed-baseline':
      await seedBaseline(baseUrl, token, manifestPath);
      break;
    case 'verify-current':
      await verifyCurrent(baseUrl, token, manifestPath);
      break;
    default:
      throw new Error(`Unknown upgrade fixture command: ${command}`);
  }
}
