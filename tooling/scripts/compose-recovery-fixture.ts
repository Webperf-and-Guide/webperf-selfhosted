import { createHash } from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type RecoveryManifest = {
  schemaVersion: 1;
  job: {
    id: string;
    region: string;
  };
  browserAudit: {
    id: string;
    region: string;
    artifactUrl: string;
    artifactSha256: string;
  };
};

const terminalJobStatuses = new Set(['succeeded', 'failed']);
const terminalAuditStatuses = new Set(['succeeded', 'failed', 'cancelled']);
const defaultTimeoutMs = 6 * 60 * 1_000;
const minimumTimeoutMs = 30_000;
const maximumTimeoutMs = 10 * 60 * 1_000;

const requireArgument = (index: number, label: string) => {
  const value = process.argv[index]?.trim();
  if (!value) {
    throw new Error(`Missing ${label}`);
  }
  return value;
};

const parseTimeoutMs = () => {
  const raw = process.env.WEBPERF_RECOVERY_TIMEOUT_MS?.trim();
  if (!raw) {
    return defaultTimeoutMs;
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimumTimeoutMs || value > maximumTimeoutMs) {
    throw new Error(
      `WEBPERF_RECOVERY_TIMEOUT_MS must be an integer from ${minimumTimeoutMs} to ${maximumTimeoutMs}`
    );
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
    throw new Error('Recovery fixture base URL must be a credential-free loopback HTTP origin');
  }
  return url.origin;
};

const requestJson = async (
  baseUrl: string,
  token: string,
  path: string,
  init: RequestInit = {}
) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...init.headers
    },
    signal: AbortSignal.timeout(20_000)
  });
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

const waitForResource = async ({
  baseUrl,
  token,
  path,
  terminalStatuses,
  timeoutMs,
  label
}: {
  baseUrl: string;
  token: string;
  path: string;
  terminalStatuses: Set<string>;
  timeoutMs: number;
  label: string;
}) => {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = '';
  while (Date.now() < deadline) {
    const payload = requireObject(await requestJson(baseUrl, token, path), label);
    const status = requireString(payload.status, `${label}.status`);
    lastStatus = status;
    if (terminalStatuses.has(status)) {
      return payload;
    }
    await Bun.sleep(2_000);
  }
  throw new Error(`${label} did not finish within ${timeoutMs}ms (last status: ${lastStatus || 'unknown'})`);
};

const downloadArtifactSha256 = async (
  baseUrl: string,
  token: string,
  artifactUrl: string
) => {
  if (!artifactUrl.startsWith('/v1/browser-audits/')) {
    throw new Error('Recovery fixture artifact URL must use the local Browser Audit API');
  }
  const response = await fetch(`${baseUrl}${artifactUrl}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Artifact download failed with ${response.status}`);
  }
  return createHash('sha256')
    .update(new Uint8Array(await response.arrayBuffer()))
    .digest('hex');
};

const parseArtifact = (audit: Record<string, unknown>) => {
  const result = requireObject(audit.result, 'browserAudit.result');
  if (!Array.isArray(result.artifacts) || result.artifacts.length === 0) {
    throw new Error('Browser Audit must persist at least one artifact');
  }
  const artifact = requireObject(result.artifacts[0], 'browserAudit.result.artifacts[0]');
  return {
    artifactUrl: requireString(artifact.url, 'artifact.url'),
    artifactSha256: requireString(artifact.sha256, 'artifact.sha256')
  };
};

const seed = async (
  baseUrl: string,
  token: string,
  manifestPath: string,
  timeoutMs: number
) => {
  const createdJobResponse = requireObject(
    await requestJson(baseUrl, token, '/v1/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/',
        note: 'compose recovery drill'
      })
    }),
    'createJobResponse'
  );
  const createdJob = requireObject(createdJobResponse.job, 'createJobResponse.job');
  const jobId = requireString(createdJob.id, 'job.id');
  const job = await waitForResource({
    baseUrl,
    token,
    path: `/v1/jobs/${encodeURIComponent(jobId)}`,
    terminalStatuses: terminalJobStatuses,
    timeoutMs,
    label: 'job'
  });
  if (job.status !== 'succeeded') {
    throw new Error(`Recovery fixture Fast Check failed: ${JSON.stringify(job).slice(0, 2_048)}`);
  }

  const createdAudit = requireObject(
    await requestJson(baseUrl, token, '/v1/browser-audits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetUrl: 'https://example.com/',
        policy: {
          preset: 'mobile',
          flow: {
            steps: [{ type: 'navigate', url: 'https://example.com/' }]
          }
        }
      })
    }),
    'createBrowserAuditResponse'
  );
  const auditId = requireString(createdAudit.id, 'browserAudit.id');
  const audit = await waitForResource({
    baseUrl,
    token,
    path: `/v1/browser-audits/${encodeURIComponent(auditId)}`,
    terminalStatuses: terminalAuditStatuses,
    timeoutMs,
    label: 'browserAudit'
  });
  if (audit.status !== 'succeeded') {
    throw new Error(`Recovery fixture Browser Audit failed: ${JSON.stringify(audit).slice(0, 2_048)}`);
  }

  const artifact = parseArtifact(audit);
  const downloadedSha256 = await downloadArtifactSha256(
    baseUrl,
    token,
    artifact.artifactUrl
  );
  if (downloadedSha256 !== artifact.artifactSha256) {
    throw new Error(
      `Seed artifact digest mismatch: expected ${artifact.artifactSha256}, got ${downloadedSha256}`
    );
  }

  const manifest: RecoveryManifest = {
    schemaVersion: 1,
    job: {
      id: jobId,
      region: requireString(job.region, 'job.region')
    },
    browserAudit: {
      id: auditId,
      region: requireString(audit.region, 'browserAudit.region'),
      artifactUrl: artifact.artifactUrl,
      artifactSha256: artifact.artifactSha256
    }
  };
  const destination = resolve(manifestPath);
  await writeFile(destination, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx'
  });
  await chmod(destination, 0o600);
  console.log(JSON.stringify({ ok: true, command: 'seed', manifest }));
};

const parseManifest = async (path: string): Promise<RecoveryManifest> => {
  const payload = requireObject(
    JSON.parse(await Bun.file(resolve(path)).text()),
    'recovery manifest'
  );
  if (payload.schemaVersion !== 1) {
    throw new Error('Recovery manifest schemaVersion must be 1');
  }
  const job = requireObject(payload.job, 'manifest.job');
  const browserAudit = requireObject(payload.browserAudit, 'manifest.browserAudit');
  return {
    schemaVersion: 1,
    job: {
      id: requireString(job.id, 'manifest.job.id'),
      region: requireString(job.region, 'manifest.job.region')
    },
    browserAudit: {
      id: requireString(browserAudit.id, 'manifest.browserAudit.id'),
      region: requireString(browserAudit.region, 'manifest.browserAudit.region'),
      artifactUrl: requireString(browserAudit.artifactUrl, 'manifest.browserAudit.artifactUrl'),
      artifactSha256: requireString(
        browserAudit.artifactSha256,
        'manifest.browserAudit.artifactSha256'
      )
    }
  };
};

const verify = async (baseUrl: string, token: string, manifestPath: string) => {
  const manifest = await parseManifest(manifestPath);
  const job = requireObject(
    await requestJson(baseUrl, token, `/v1/jobs/${encodeURIComponent(manifest.job.id)}`),
    'restored job'
  );
  if (job.status !== 'succeeded' || job.region !== manifest.job.region) {
    throw new Error('Restored Fast Check does not match the recovery manifest');
  }

  const audit = requireObject(
    await requestJson(
      baseUrl,
      token,
      `/v1/browser-audits/${encodeURIComponent(manifest.browserAudit.id)}`
    ),
    'restored Browser Audit'
  );
  if (audit.status !== 'succeeded' || audit.region !== manifest.browserAudit.region) {
    throw new Error('Restored Browser Audit does not match the recovery manifest');
  }
  const artifact = parseArtifact(audit);
  if (
    artifact.artifactUrl !== manifest.browserAudit.artifactUrl
    || artifact.artifactSha256 !== manifest.browserAudit.artifactSha256
  ) {
    throw new Error('Restored Browser Audit artifact metadata changed');
  }

  const unauthenticated = await fetch(`${baseUrl}${artifact.artifactUrl}`, {
    signal: AbortSignal.timeout(20_000)
  });
  await unauthenticated.body?.cancel();
  if (unauthenticated.status !== 401) {
    throw new Error(
      `Restored artifact must remain authenticated; unauthenticated status was ${unauthenticated.status}`
    );
  }

  const downloadedSha256 = await downloadArtifactSha256(
    baseUrl,
    token,
    artifact.artifactUrl
  );
  if (downloadedSha256 !== manifest.browserAudit.artifactSha256) {
    throw new Error(
      `Restored artifact digest mismatch: expected ${manifest.browserAudit.artifactSha256}, got ${downloadedSha256}`
    );
  }

  console.log(JSON.stringify({
    ok: true,
    command: 'verify',
    jobId: manifest.job.id,
    auditId: manifest.browserAudit.id,
    artifactSha256: downloadedSha256
  }));
};

const command = requireArgument(2, 'command');
const baseUrl = parseBaseUrl(requireArgument(3, 'base URL'));
const token = requireArgument(4, 'administrator token');
const manifestPath = requireArgument(5, 'manifest path');

switch (command) {
  case 'seed':
    await seed(baseUrl, token, manifestPath, parseTimeoutMs());
    break;
  case 'verify':
    await verify(baseUrl, token, manifestPath);
    break;
  default:
    throw new Error(`Unknown recovery fixture command: ${command}`);
}
