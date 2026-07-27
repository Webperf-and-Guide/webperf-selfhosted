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
  privileged?: boolean;
  cap_add?: string[];
  cap_drop?: string[];
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
const appArmorComposeFile = resolve(repositoryRoot, 'infra/docker-compose/compose.apparmor.yml');
const browserSeccompFile = resolve(repositoryRoot, 'infra/docker-compose/browser-audit-seccomp.json');
const browserAppArmorFile = resolve(repositoryRoot, 'infra/docker-compose/browser-audit.apparmor');
const composeRenderTimeoutMs = 30_000;
const maximumTmpfsBytes = 2 * 1024 ** 3;
const defaultServiceNames = ['api', 'console', 'executor', 'probe', 'scheduler'];
const expectedImages: Record<string, string> = {
  api: 'webperf',
  console: 'webperf',
  executor: 'webperf',
  probe: 'webperf-probe',
  scheduler: 'webperf',
  'browser-audit-lighthouse': 'webperf-browser-audit-lighthouse'
};
const browserCapabilityAdditions = ['SYS_CHROOT'];
const expectedCapabilityAdditions: Record<string, string[]> = {
  'browser-audit-lighthouse': browserCapabilityAdditions
};
const nonRootNumericUserPattern = /^[1-9]\d*(?::[1-9]\d*)?$/;

assert(nonRootNumericUserPattern.test('1000'), 'numeric non-root UID must be accepted');
assert(nonRootNumericUserPattern.test('1000:1000'), 'numeric non-root UID:GID must be accepted');
for (const unsafeUser of ['0', '0:1000', '1000:0']) {
  assert(
    !nonRootNumericUserPattern.test(unsafeUser),
    `numeric container user ${unsafeUser} must be rejected`
  );
}

const production = renderCompose([productionFile]);
const productionWithProfiles = renderCompose(
  [productionFile],
  ['browser-audit', 'debug']
);
const developmentWithProfiles = renderCompose(
  [productionFile, developmentFile],
  ['browser-audit', 'debug']
);
const developmentWithAppArmorProfiles = renderCompose(
  [productionFile, developmentFile, appArmorComposeFile],
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
  const privilegeOptions = service.security_opt?.filter(
    (entry) => entry.startsWith('no-new-privileges:')
  ) ?? [];
  assert(
    nonRootNumericUserPattern.test(service.user ?? ''),
    `${name} must run as an explicit non-root numeric user`
  );
  assert(
    service.cap_drop?.includes('ALL'),
    `${name} must drop all Linux capabilities`
  );
  assertStringArrayEqual(
    [...(service.cap_add ?? [])].sort(),
    [...(expectedCapabilityAdditions[name] ?? [])].sort(),
    name === 'browser-audit-lighthouse'
      ? 'Browser Audit runner minimal sandbox capabilities'
      : `${name} capability additions`
  );
  assert(service.privileged !== true, `${name} must not run privileged`);
  assert(
    privilegeOptions.length === 1 && privilegeOptions[0] === 'no-new-privileges:true',
    `${name} must prevent privilege escalation`
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
  assertSecureTmpfs(productionWithProfiles.services[name], '/tmp', name);
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
    healthCommand.includes('node:fs/promises')
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
assert(
  browser.security_opt?.some(
    (entry) => entry.startsWith('seccomp=') && entry.endsWith('browser-audit-seccomp.json')
  ),
  'Browser Audit runner must use the checked-in Chromium seccomp profile'
);
assertSecureTmpfs(browser, '/tmp', 'Browser Audit runner');
assertSecureTmpfs(browser, '/home/bun', 'Browser Audit runner home');
assertBrowserSeccompProfile();
assertBrowserAppArmorProfile();
assert(
  parseSizeToBytes(browser.shm_size) >= 1024 ** 3,
  'Browser Audit runner must have at least 1 GiB of shared memory'
);
assert(parseSizeToBytes('1gb') === 1000 ** 3, 'decimal Compose sizes must use base 1000');
assert(parseSizeToBytes('1gib') === 1024 ** 3, 'binary Compose sizes must use base 1024');
assert(Number.isNaN(parseSizeToBytes('1i')), 'malformed Compose sizes must be rejected');
assert(Number.isNaN(parseSizeToBytes('0x10')), 'hexadecimal Compose sizes must be rejected');
assert(Number.isNaN(parseSizeToBytes('1e5')), 'exponential Compose sizes must be rejected');
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
const appArmorBrowser = developmentWithAppArmorProfiles.services['browser-audit-lighthouse'];
assert(
  appArmorBrowser.security_opt?.includes('apparmor=webperf-browser-audit'),
  'Browser Audit AppArmor overlay must select the checked-in host profile'
);
assertStringArrayEqual(
  appArmorBrowser.cap_drop,
  browser.cap_drop,
  'Browser Audit AppArmor overlay capability drops'
);
assertStringArrayEqual(
  appArmorBrowser.cap_add,
  browser.cap_add,
  'Browser Audit AppArmor overlay capability additions'
);
assertLoopbackPort(productionWithProfiles.services['api-debug'], 8789, 'API debug proxy');
assertLoopbackPort(
  productionWithProfiles.services['browser-audit-debug'],
  8789,
  'Browser Audit debug proxy'
);
assertAllPublishedPortsLoopback(productionWithProfiles, 'production Compose');
assertAllPublishedPortsLoopback(developmentWithProfiles, 'development Compose');

// Phase 2 of issue #14: Bun services share one webperf image. Only services
// with distinct Dockerfiles (webperf via api, probe, browser-audit-lighthouse)
// need a build override; the others reference the same webperf:dev tag.
const buildRequiredServices = ['api', 'probe', 'browser-audit-lighthouse'];

for (const name of Object.keys(expectedImages)) {
  if (buildRequiredServices.includes(name)) {
    assert(
      Boolean(developmentWithProfiles.services[name]?.build),
      `${name} must have a source-build development override`
    );
  }
  assert(
    developmentWithProfiles.services[name]?.image?.endsWith(':dev') === true,
    `${name} development image must use a local :dev tag`
  );
}

const productionServiceNames = Object.keys(productionWithProfiles.services).sort();
assertStringArrayEqual(
  Object.keys(developmentWithProfiles.services).sort(),
  productionServiceNames,
  'development and production Compose service sets'
);
for (const name of productionServiceNames) {
  const productionService = productionWithProfiles.services[name];
  const developmentService = developmentWithProfiles.services[name];
  assert(productionService, `${name} must exist in the production model`);
  assert(developmentService, `${name} must exist in the development model`);
  assertSecurityParity(name, productionService, developmentService);
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
    stderr: 'pipe',
    timeout: composeRenderTimeoutMs
  });

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    if (result.exitCode === null) {
      throw new Error(
        `docker compose config did not complete (timeout after ${composeRenderTimeoutMs / 1_000} seconds or Docker unavailable)${stderr ? `: ${stderr}` : ''}`
      );
    }
    throw new Error(stderr || 'docker compose config failed');
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
  const ports = service?.ports?.filter((candidate) => candidate.target === target) ?? [];
  assert(ports.length > 0, `${label} must publish ${target}`);
  assert(
    ports.every((port) => port.host_ip === '127.0.0.1'),
    `${label} must bind every ${target} publication on 127.0.0.1`
  );
}

function assertAllPublishedPortsLoopback(model: ComposeModel, label: string) {
  for (const [name, service] of Object.entries(model.services)) {
    for (const port of service.ports ?? []) {
      assert(
        port.host_ip === '127.0.0.1',
        `${label} ${name} must bind published port ${port.target ?? 'unknown'} on 127.0.0.1`
      );
    }
  }
}

function assertSecureTmpfs(
  service: ComposeService | undefined,
  target: string,
  label: string
) {
  const entry = service?.tmpfs?.find((candidate) => candidate.split(':', 1)[0] === target);
  assert(entry, `${label} must use a tmpfs for ${target}`);
  const optionList = entry.slice(target.length + 1).split(',');
  const options = new Set(optionList);
  for (const option of ['rw', 'nosuid', 'nodev', 'noexec']) {
    assert(options.has(option), `${label} ${target} tmpfs must include ${option}`);
  }
  const sizeOptions = optionList.filter((option) => option.startsWith('size='));
  assert(
    sizeOptions.length === 1,
    `${label} ${target} tmpfs must define exactly one size limit`
  );
  const sizeOption = sizeOptions[0];
  assert(sizeOption, `${label} ${target} tmpfs size option must not be empty`);
  const sizeBytes = parseSizeToBytes(sizeOption.slice('size='.length));
  assert(
    Number.isFinite(sizeBytes) && sizeBytes > 0 && sizeBytes <= maximumTmpfsBytes,
    `${label} ${target} tmpfs size must be between 1 byte and 2 GiB`
  );
}

function assertSecurityParity(
  name: string,
  productionService: ComposeService,
  developmentService: ComposeService
) {
  for (const field of ['user', 'read_only', 'privileged'] as const) {
    assert(
      developmentService[field] === productionService[field],
      `${name} development ${field} must match production`
    );
  }
  for (const field of ['cap_add', 'cap_drop', 'security_opt', 'tmpfs'] as const) {
    assertStringArrayEqual(
      [...(developmentService[field] ?? [])].sort(),
      [...(productionService[field] ?? [])].sort(),
      `${name} development ${field}`
    );
  }
  assert(
    JSON.stringify(developmentService.ports ?? []) === JSON.stringify(productionService.ports ?? []),
    `${name} development ports must match production`
  );
}

function assertBrowserSeccompProfile() {
  const profile = JSON.parse(readFileSync(browserSeccompFile, 'utf8')) as {
    defaultAction?: string;
    syscalls?: Array<{
      names?: string[];
      action?: string;
      args?: unknown[];
      includes?: { caps?: string[]; minKernel?: string } | null;
      excludes?: Record<string, unknown> | null;
    }>;
  };
  assert(profile.defaultAction === 'SCMP_ACT_ERRNO', 'Browser seccomp must default-deny syscalls');
  const requiredNamespaceSyscalls = ['clone', 'setns', 'unshare'];
  const namespaceRule = profile.syscalls?.find(
    (rule) =>
      rule.action === 'SCMP_ACT_ALLOW'
      && rule.names?.length === requiredNamespaceSyscalls.length
      && requiredNamespaceSyscalls.every((name) => rule.names?.includes(name))
      && (rule.args?.length ?? 0) === 0
      && Object.keys(rule.includes ?? {}).length === 0
      && Object.keys(rule.excludes ?? {}).length === 0
  );
  assert(namespaceRule, 'Browser seccomp must allow only the required namespace syscalls explicitly');

  const highRiskSyscalls = new Set([
    'bpf',
    'mount',
    'process_vm_readv',
    'process_vm_writev',
    'ptrace',
    'reboot'
  ]);
  for (const rule of profile.syscalls ?? []) {
    if (
      rule.action !== 'SCMP_ACT_ALLOW'
      || (rule.includes?.caps?.length ?? 0) > 0
    ) {
      continue;
    }

    const unsafe = rule.names?.filter((name) => highRiskSyscalls.has(name)) ?? [];
    assert(
      unsafe.length === 0,
      `Browser seccomp must not allow high-risk syscalls without a capability condition: ${unsafe.join(', ')}`
    );
  }
}

function assertBrowserAppArmorProfile() {
  const profile = readFileSync(browserAppArmorFile, 'utf8');
  assert(
    profile.includes('abi <abi/4.0>,')
      && profile.includes('profile "webperf-browser-audit"')
      && /^\s*userns,$/m.test(profile),
    'Browser AppArmor profile must explicitly allow user namespaces under the AppArmor 4 ABI'
  );
  assert(
    profile.includes('flags=(unconfined)')
      && !profile.includes('capability sys_admin'),
    'Browser AppArmor profile must use Chromium\'s selective userns allowlist without SYS_ADMIN'
  );
}

function parseSizeToBytes(value: string | number | undefined) {
  if (typeof value === 'number') {
    return value;
  }
  if (!value) {
    return Number.NaN;
  }

  const normalized = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    return Number(normalized);
  }

  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(b|[kmgt](?:i?b)?)$/i);
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
