import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type ComposePort = {
  host_ip?: string;
  target?: number;
};

type ComposeService = {
  image?: string;
  build?: unknown;
  user?: string;
  read_only?: boolean;
  cap_add?: string[];
  cap_drop?: string[];
  security_opt?: string[];
  ports?: ComposePort[];
  expose?: number[];
  environment?: Record<string, string>;
  volumes?: Array<{ target?: string }>;
};

type ComposeModel = {
  services: Record<string, ComposeService>;
};

type MultiContainerProfile = {
  schemaVersion?: number;
  protocolVersion?: number;
  topology?: {
    replicas?: { minimum?: number; maximum?: number };
    sharedNetworkNamespace?: boolean;
    publicContainer?: string;
    publicPort?: number;
    persistentVolume?: {
      container?: string;
      mountPath?: string;
      required?: boolean;
    };
  };
  containers?: Array<{
    name?: string;
    image?: string;
    role?: string;
    ports?: number[];
    environment?: Record<string, string>;
    requiredDeploymentInputs?: string[];
  }>;
};

const repositoryRoot = resolve(import.meta.dir, '../..');
const environmentFile = resolve(repositoryRoot, 'infra/regional-runtime/.env.example');
const productionFile = resolve(repositoryRoot, 'infra/regional-runtime/compose.yml');
const developmentFile = resolve(repositoryRoot, 'infra/regional-runtime/compose.dev.yml');
const profileFile = resolve(
  repositoryRoot,
  'infra/regional-runtime/multi-container-profile.json'
);
const composeRenderTimeoutMs = 30_000;
const serviceNames = ['probe', 'regional-api', 'regional-executor'];
const imageVersionPattern = /^ghcr\.io\/webperf-and-guide\/webperf(?:-probe)?:v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

const production = renderCompose([productionFile]);
const development = renderCompose([productionFile, developmentFile]);

assertStringArrayEqual(
  Object.keys(production.services).sort(),
  serviceNames,
  'regional runtime service set'
);
assertStringArrayEqual(
  Object.keys(development.services).sort(),
  serviceNames,
  'regional runtime development service set'
);

for (const name of serviceNames) {
  const service = production.services[name];
  const developmentService = development.services[name];
  assert(service, `${name} must exist`);
  assert(developmentService, `${name} development service must exist`);
  assert(imageVersionPattern.test(service.image ?? ''), `${name} must use a versioned release image`);
  assert(!service.build, `${name} production service must not contain a source build`);
  assert(Boolean(developmentService.build), `${name} development service must build from source`);
  assert(developmentService.image?.endsWith(':dev'), `${name} development image must use :dev`);
  assertServiceSecurity(service, name);
  assertServiceSecurity(developmentService, `${name} development service`);
  for (const sensitiveVariable of [
    'SELFHOST_ADMIN_TOKEN',
    'BROWSER_AUDIT_SHARED_SECRET',
    'SELFHOST_BROWSER_AUDIT_BASE_URL'
  ]) {
    assert(
      service.environment?.[sensitiveVariable] === undefined,
      `${name} must not carry ${sensitiveVariable}`
    );
    assert(
      developmentService.environment?.[sensitiveVariable] === undefined,
      `${name} development service must not carry ${sensitiveVariable}`
    );
  }
}

const regionalApi = production.services['regional-api'];
const executor = production.services['regional-executor'];
const probe = production.services.probe;
assert(regionalApi, 'regional-api must exist');
assert(executor, 'regional-executor must exist');
assert(probe, 'probe must exist');

assert(regionalApi.environment?.WEBPERF_ROLE === 'regional-runtime', 'API must force regional role');
assert(
  regionalApi.environment?.SELFHOST_SCHEDULER_MODE === 'disabled',
  'regional API must disable scheduling'
);
assert(
  regionalApi.volumes?.some((volume) => volume.target === '/data'),
  'regional API must retain the durable /data volume'
);
assertLoopbackPort(regionalApi, 8788, 'regional API');
assert((executor.ports?.length ?? 0) === 0, 'executor must not publish ports');
assert((probe.ports?.length ?? 0) === 0, 'probe must not publish ports');
assert((executor.expose?.length ?? 0) === 0, 'executor must not expose ports');
assertStringArrayEqual(
  (regionalApi.expose ?? []).map(String),
  ['8788'],
  'regional API exposed process port'
);
assertStringArrayEqual(
  (probe.expose ?? []).map(String),
  ['8080'],
  'probe exposed process port'
);

let profile: MultiContainerProfile;
try {
  profile = JSON.parse(readFileSync(profileFile, 'utf8')) as MultiContainerProfile;
} catch (cause) {
  throw new Error(`Unable to read regional runtime profile ${profileFile}`, { cause });
}
assert(profile.schemaVersion === 1, 'multi-container profile schemaVersion must be 1');
assert(profile.protocolVersion === 1, 'multi-container profile protocolVersion must be 1');
assert(
  profile.topology?.replicas?.minimum === 1
    && profile.topology.replicas.maximum === 1,
  'regional runtime profile must remain single-replica'
);
assert(
  profile.topology?.sharedNetworkNamespace === true,
  'managed multi-container profile must require one shared network namespace'
);
assert(
  profile.topology?.publicContainer === 'regional-api'
    && profile.topology.publicPort === 8788,
  'only regional API port 8788 may be public'
);
assert(
  profile.topology?.persistentVolume?.container === 'regional-api'
    && profile.topology.persistentVolume.mountPath === '/data'
    && profile.topology.persistentVolume.required === true,
  'managed profile must persist regional API state at /data'
);

const profileContainers = profile.containers ?? [];
assertStringArrayEqual(
  profileContainers.map(({ name }) => name ?? '').sort(),
  serviceNames,
  'managed multi-container service set'
);
const publicPorts = profileContainers.flatMap(({ name, ports }) =>
  (ports ?? []).map((port) => ({ name, port }))
);
assert(
  publicPorts.some(({ name, port }) => name === 'regional-api' && port === 8788),
  'managed profile must expose the regional API process port'
);
assert(
  publicPorts.some(({ name, port }) => name === 'probe' && port === 8080),
  'managed profile must declare the private probe process port'
);
assert(
  new Set(publicPorts.map(({ port }) => port)).size === publicPorts.length,
  'co-located containers must use distinct ports'
);
for (const container of profileContainers) {
  assert(
    (container.requiredDeploymentInputs?.length ?? 0) > 0,
    `${container.name ?? 'unknown'} must declare deployment inputs`
  );
}
const profileApi = profileContainers.find(({ name }) => name === 'regional-api');
const profileExecutor = profileContainers.find(({ name }) => name === 'regional-executor');
const profileProbe = profileContainers.find(({ name }) => name === 'probe');
assert(
  profileApi?.requiredDeploymentInputs?.includes('SELFHOST_REGION_ID'),
  'managed profile API must require the deployment region input'
);
assert(
  profileProbe?.environment?.REGION_ID === '${SELFHOST_REGION_ID}',
  'managed profile probe REGION_ID must derive from SELFHOST_REGION_ID'
);
assert(
  profileProbe.requiredDeploymentInputs?.includes('SELFHOST_REGION_ID')
    && !profileProbe.requiredDeploymentInputs.includes('REGION_ID'),
  'managed profile must expose one region deployment input for API and probe'
);
for (const input of [
  'SELFHOST_REGION_ID',
  'WEBPERF_RUNTIME_VERSION',
  'WEBPERF_RUNTIME_IMAGE_DIGEST',
  'WEBPERF_PROBE_IMAGE_DIGEST'
]) {
  assert(
    profileExecutor?.requiredDeploymentInputs?.includes(input),
    `managed profile executor must require ${input}`
  );
}

console.log(JSON.stringify({
  ok: true,
  services: serviceNames,
  publicService: 'regional-api',
  publicPort: 8788,
  replicas: 1
}));

function renderCompose(files: string[]): ComposeModel {
  const command = ['docker', 'compose', '--env-file', environmentFile];
  for (const file of files) {
    command.push('-f', file);
  }
  command.push('config', '--format', 'json');
  const result = Bun.spawnSync(command, {
    cwd: repositoryRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: composeRenderTimeoutMs
  });
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    if (result.exitCode === null) {
      throw new Error(
        `regional runtime Compose render did not complete (timeout after ${composeRenderTimeoutMs / 1_000} seconds or Docker unavailable)${stderr ? `: ${stderr}` : ''}`
      );
    }
    throw new Error(stderr || 'regional runtime Compose render failed');
  }

  const stdout = result.stdout.toString();
  try {
    return JSON.parse(stdout) as ComposeModel;
  } catch (error) {
    throw new Error(
      `regional runtime Compose render returned invalid JSON: ${error instanceof Error ? error.message : String(error)}\nOutput (truncated): ${stdout.slice(0, 500)}`
    );
  }
}

function assertLoopbackPort(
  service: ComposeService,
  target: number,
  label: string
) {
  const ports = service.ports?.filter((candidate) => candidate.target === target) ?? [];
  assert(ports.length === 1, `${label} must publish ${target} exactly once`);
  assert(ports[0]?.host_ip === '127.0.0.1', `${label} must bind on loopback`);
}

function assertStringArrayEqual(actual: string[], expected: string[], label: string) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

function assertServiceSecurity(service: ComposeService, label: string) {
  assert(service.read_only === true, `${label} must use a read-only root filesystem`);
  const user = service.user?.split(':', 1)[0]?.toLowerCase();
  assert(
    user !== undefined && user !== '' && user !== '0' && user !== 'root',
    `${label} must run as non-root`
  );
  assert(service.cap_drop?.includes('ALL'), `${label} must drop all Linux capabilities`);
  assert((service.cap_add?.length ?? 0) === 0, `${label} must not add Linux capabilities`);
  assert(
    service.security_opt?.includes('no-new-privileges:true'),
    `${label} must prevent privilege escalation`
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
