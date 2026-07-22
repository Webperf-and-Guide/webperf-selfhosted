import { resolve } from 'node:path';

type ComposePort = {
  host_ip?: string;
  target?: number;
  published?: string;
};

type ComposeService = {
  image?: string;
  build?: unknown;
  user?: string;
  read_only?: boolean;
  restart?: string;
  stop_grace_period?: string;
  healthcheck?: { test?: string[] };
  deploy?: { resources?: { limits?: { cpus?: number; memory?: string } } };
  logging?: { options?: { 'max-file'?: string; 'max-size'?: string } };
  ports?: ComposePort[];
  profiles?: string[];
  cap_add?: string[];
  tmpfs?: string[];
  shm_size?: string;
  environment?: Record<string, string>;
  volumes?: Array<{ target?: string }>;
};

type ComposeModel = {
  services: Record<string, ComposeService>;
};

const repositoryRoot = resolve(import.meta.dir, '../..');
const envFile = resolve(repositoryRoot, 'infra/docker-compose/.env.example');
const productionFile = resolve(repositoryRoot, 'infra/docker-compose/compose.yml');
const developmentFile = resolve(repositoryRoot, 'infra/docker-compose/compose.dev.yml');
const defaultServiceNames = ['api', 'console', 'executor', 'probe', 'scheduler'];
const expectedImages: Record<string, string> = {
  api: 'webperf-api',
  console: 'webperf-console',
  executor: 'webperf-executor',
  probe: 'webperf-probe',
  scheduler: 'webperf-scheduler',
  'browser-audit-lighthouse': 'webperf-browser-audit-lighthouse'
};

const production = renderCompose([productionFile]);
const productionWithProfiles = renderCompose(
  [productionFile],
  ['browser-audit', 'debug']
);
const developmentWithProfiles = renderCompose(
  [productionFile, developmentFile],
  ['browser-audit', 'debug']
);

assertDeepEqual(
  Object.keys(production.services).sort(),
  defaultServiceNames,
  'default Compose services'
);

for (const [name, expectedImage] of Object.entries(expectedImages)) {
  const service = productionWithProfiles.services[name];
  assert(service, `${name} must exist in the production model`);
  assert(!service.build, `${name} production service must not contain a source build`);
  assert(
    new RegExp(`^ghcr\\.io/webperf-and-guide/${expectedImage}:v?\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$`).test(
      service.image ?? ''
    ),
    `${name} must use a versioned GHCR image`
  );
}

for (const [name, service] of Object.entries(productionWithProfiles.services)) {
  assert(service.user !== undefined && !service.user.startsWith('0'), `${name} must run as non-root`);
  assert(service.read_only === true, `${name} must use a read-only root filesystem`);
  assert(service.restart === 'unless-stopped', `${name} must restart unless stopped`);
  assert(Boolean(service.stop_grace_period), `${name} must define a stop grace period`);
  assert(Boolean(service.healthcheck?.test?.length), `${name} must define a healthcheck`);
  assert(Boolean(service.deploy?.resources?.limits?.cpus), `${name} must define a CPU limit`);
  assert(Boolean(service.deploy?.resources?.limits?.memory), `${name} must define a memory limit`);
  assert(service.logging?.options?.['max-size'] === '10m', `${name} must rotate logs by size`);
  assert(service.logging?.options?.['max-file'] === '3', `${name} must cap rotated log files`);
}

for (const name of ['api', 'console', 'executor', 'scheduler', 'api-debug', 'browser-audit-debug']) {
  assert(
    productionWithProfiles.services[name]?.tmpfs?.some((entry) => entry.startsWith('/tmp:')),
    `${name} must use a tmpfs for /tmp`
  );
}

assertDeepEqual(
  Object.entries(production.services)
    .filter(([, service]) => (service.ports?.length ?? 0) > 0)
    .map(([name]) => name),
  ['console'],
  'default published services'
);
assertLoopbackPort(production.services.console, 3000, 'console');
assert(
  production.services.api.volumes?.some((volume) => volume.target === '/data'),
  'API must retain the writable /data volume'
);

const browser = productionWithProfiles.services['browser-audit-lighthouse'];
assertDeepEqual(browser.profiles?.sort(), ['browser-audit', 'debug'], 'Browser Audit profiles');
assert((browser.ports?.length ?? 0) === 0, 'Browser Audit runner must not publish a host port');
assert(!browser.cap_add?.includes('SYS_ADMIN'), 'Browser Audit runner must not add SYS_ADMIN');
assert(Number(browser.shm_size) >= 1024 ** 3, 'Browser Audit runner must have at least 1 GiB of shared memory');
assert(
  browser.environment?.BROWSER_AUDIT_ALLOW_NO_SANDBOX === 'false',
  'Browser Audit sandbox must be enabled by default'
);
assertLoopbackPort(productionWithProfiles.services['api-debug'], 8789, 'API debug proxy');
assertLoopbackPort(
  productionWithProfiles.services['browser-audit-debug'],
  8789,
  'Browser Audit debug proxy'
);

for (const name of Object.keys(expectedImages)) {
  assert(
    Boolean(developmentWithProfiles.services[name]?.build),
    `${name} must have a source-build development override`
  );
  assert(
    developmentWithProfiles.services[name]?.image?.endsWith(':dev') === true,
    `${name} development image must use a local :dev tag`
  );
}

console.log(
  JSON.stringify({
    ok: true,
    defaultServices: defaultServiceNames,
    optionalProfiles: ['browser-audit', 'debug']
  })
);

function renderCompose(files: string[], profiles: string[] = []): ComposeModel {
  const command = ['docker', 'compose', '--env-file', envFile];

  for (const profile of profiles) {
    command.push('--profile', profile);
  }

  for (const file of files) {
    command.push('-f', file);
  }

  command.push('config', '--format', 'json');
  const result = Bun.spawnSync(command, {
    cwd: repositoryRoot,
    stdout: 'pipe',
    stderr: 'pipe'
  });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString() || 'docker compose config failed');
  }

  return JSON.parse(result.stdout.toString()) as ComposeModel;
}

function assertLoopbackPort(service: ComposeService | undefined, target: number, label: string) {
  const port = service?.ports?.find((candidate) => candidate.target === target);
  assert(port?.host_ip === '127.0.0.1', `${label} must bind ${target} on 127.0.0.1`);
}

function assertDeepEqual(actual: unknown, expected: unknown, label: string) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
