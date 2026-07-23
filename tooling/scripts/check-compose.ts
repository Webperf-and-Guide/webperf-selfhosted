import { readFileSync } from 'node:fs';
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
  security_opt?: string[];
  tmpfs?: string[];
  shm_size?: string | number;
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
const browserSeccompFile = resolve(repositoryRoot, 'infra/docker-compose/browser-audit-seccomp.json');
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

assertStringArrayEqual(
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
  const runtimeUser = service.user?.split(':', 1)[0];
  assert(
    runtimeUser !== undefined && runtimeUser !== '0' && runtimeUser !== 'root',
    `${name} must run as non-root`
  );
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

for (const [name, heartbeatPath] of Object.entries({
  scheduler: '/tmp/webperf-scheduler-heartbeat',
  executor: '/tmp/webperf-executor-heartbeat'
})) {
  const service = productionWithProfiles.services[name];
  const healthCommand = service?.healthcheck?.test?.join(' ') ?? '';
  assert(
    service?.environment?.WEBPERF_PROCESS_HEARTBEAT_PATH === heartbeatPath,
    `${name} must publish its process heartbeat path to the healthcheck`
  );
  assert(
    healthCommand.includes("node:fs/promises")
      && healthCommand.includes(heartbeatPath)
      && healthCommand.includes('mtimeMs'),
    `${name} healthcheck must validate its own process heartbeat freshness`
  );
  assert(
    !healthCommand.includes('SELFHOST_') && !healthCommand.includes('/health'),
    `${name} healthcheck must not proxy the API health endpoint`
  );
}

assertStringArrayEqual(
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
assertStringArrayEqual(browser.profiles?.sort(), ['browser-audit', 'debug'], 'Browser Audit profiles');
assert((browser.ports?.length ?? 0) === 0, 'Browser Audit runner must not publish a host port');
assert(!browser.cap_add?.includes('SYS_ADMIN'), 'Browser Audit runner must not add SYS_ADMIN');
assert(
  browser.security_opt?.some(
    (entry) => entry.startsWith('seccomp=') && entry.endsWith('browser-audit-seccomp.json')
  ),
  'Browser Audit runner must use the checked-in Chromium seccomp profile'
);
assertBrowserSeccompProfile();
assert(
  parseSizeToBytes(browser.shm_size) >= 1024 ** 3,
  'Browser Audit runner must have at least 1 GiB of shared memory'
);
assert(parseSizeToBytes('1gb') === 1000 ** 3, 'decimal Compose sizes must use base 1000');
assert(parseSizeToBytes('1gib') === 1024 ** 3, 'binary Compose sizes must use base 1024');
assert(Number.isNaN(parseSizeToBytes('1i')), 'malformed Compose sizes must be rejected');
assert(
  browser.environment?.BROWSER_AUDIT_ALLOW_NO_SANDBOX === 'false',
  'Browser Audit sandbox must be enabled by default'
);
const selectedBrowserRuntimeVersion = browser.image?.match(/:([^:@]+)$/)?.[1];
assert(
  Boolean(selectedBrowserRuntimeVersion)
    && browser.environment?.WEBPERF_RUNTIME_VERSION === selectedBrowserRuntimeVersion,
  'Browser Audit runner version must match its selected image tag'
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

  const stdout = result.stdout.toString();
  try {
    return JSON.parse(stdout) as ComposeModel;
  } catch (error) {
    throw new Error(
      `docker compose config returned invalid JSON: ${error instanceof Error ? error.message : String(error)}\nOutput (truncated): ${stdout.slice(0, 500)}`
    );
  }
}

function assertLoopbackPort(service: ComposeService | undefined, target: number, label: string) {
  const port = service?.ports?.find((candidate) => candidate.target === target);
  assert(port?.host_ip === '127.0.0.1', `${label} must bind ${target} on 127.0.0.1`);
}

function assertBrowserSeccompProfile() {
  const profile = JSON.parse(readFileSync(browserSeccompFile, 'utf8')) as {
    defaultAction?: string;
    syscalls?: Array<{ names?: string[]; action?: string }>;
  };
  assert(profile.defaultAction === 'SCMP_ACT_ERRNO', 'Browser seccomp must default-deny syscalls');
  const namespaceRule = profile.syscalls?.find(
    (rule) =>
      rule.action === 'SCMP_ACT_ALLOW'
      && JSON.stringify(rule.names) === JSON.stringify(['clone', 'setns', 'unshare'])
  );
  assert(namespaceRule, 'Browser seccomp must allow only the required namespace syscalls explicitly');
}

function parseSizeToBytes(value: string | number | undefined) {
  if (typeof value === 'number') {
    return value;
  }
  if (!value) {
    return Number.NaN;
  }

  const direct = Number(value);
  if (Number.isFinite(direct)) {
    return direct;
  }

  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(b|[kmgt](?:i?b)?)$/i);
  if (!match) {
    return Number.NaN;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const baseUnit = unit.replace('i', '').replace(/b$/, '');
  const exponent = ['', 'k', 'm', 'g', 't'].indexOf(baseUnit);
  if (exponent < 0) {
    return Number.NaN;
  }

  return amount * (unit.includes('i') ? 1024 : 1000) ** exponent;
}

function assertStringArrayEqual(
  actual: string[] | undefined,
  expected: string[],
  label: string
) {
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
