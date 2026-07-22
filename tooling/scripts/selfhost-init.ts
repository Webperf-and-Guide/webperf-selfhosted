import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../..');
const examplePath = resolve(repositoryRoot, 'infra/docker-compose/.env.example');
const outputArgumentIndex = process.argv.indexOf('--output');
const outputPath = resolve(
  repositoryRoot,
  outputArgumentIndex >= 0 && process.argv[outputArgumentIndex + 1]
    ? process.argv[outputArgumentIndex + 1]!
    : 'infra/docker-compose/.env'
);

if (existsSync(outputPath)) {
  throw new Error(`Refusing to overwrite existing configuration: ${outputPath}`);
}

const secretKeys = [
  'SELFHOST_ADMIN_TOKEN',
  'SELFHOST_INTERNAL_SECRET',
  'PROBE_SHARED_SECRET',
  'BROWSER_AUDIT_SHARED_SECRET'
];
const nextSecretKeys = [
  'SELFHOST_ADMIN_TOKEN_NEXT',
  'SELFHOST_INTERNAL_SECRET_NEXT',
  'PROBE_SHARED_SECRET_NEXT',
  'BROWSER_AUDIT_SHARED_SECRET_NEXT'
];
const generated = new Map(secretKeys.map((key) => [key, randomBytes(32).toString('base64url')]));
const content = readFileSync(examplePath, 'utf8')
  .split('\n')
  .map((line) => {
    const separator = line.indexOf('=');

    if (separator < 0) {
      return line;
    }

    const key = line.slice(0, separator);

    if (generated.has(key)) {
      return `${key}=${generated.get(key)}`;
    }

    if (nextSecretKeys.includes(key)) {
      return `${key}=`;
    }

    return line;
  })
  .join('\n');

writeFileSync(outputPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ ok: true, configPath: outputPath }));
