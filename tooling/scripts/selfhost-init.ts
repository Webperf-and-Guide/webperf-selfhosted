import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../..');
const examplePath = resolve(repositoryRoot, 'infra/docker-compose/.env.example');
const secretKeys = [
  'SELFHOST_ADMIN_TOKEN',
  'SELFHOST_INTERNAL_SECRET',
  'PROBE_SHARED_SECRET',
  'BROWSER_AUDIT_SHARED_SECRET'
] as const;
const nextSecretKeys = secretKeys.map((key) => `${key}_NEXT`);

export const renderSelfhostEnvironment = (
  template: string,
  generateSecret = () => randomBytes(32).toString('base64url')
) => {
  const generated = new Map(secretKeys.map((key) => [key, generateSecret()]));
  const substituted = new Set<string>();
  const content = template
    .split('\n')
    .map((line) => {
      const separator = line.indexOf('=');

      if (separator < 0) {
        return line;
      }

      const key = line.slice(0, separator);

      if (generated.has(key as (typeof secretKeys)[number])) {
        substituted.add(key);
        return `${key}=${generated.get(key as (typeof secretKeys)[number])}`;
      }

      if (nextSecretKeys.includes(key)) {
        substituted.add(key);
        return `${key}=`;
      }

      return line;
    })
    .join('\n');
  const requiredKeys = [...secretKeys, ...nextSecretKeys];
  const missing = requiredKeys.filter((key) => !substituted.has(key));

  if (missing.length > 0) {
    throw new Error(`Self-host environment template is missing required keys: ${missing.join(', ')}`);
  }

  return content;
};

const main = () => {
  const outputArgumentIndex = process.argv.indexOf('--output');

  if (outputArgumentIndex >= 0 && !process.argv[outputArgumentIndex + 1]) {
    throw new Error('--output requires a path');
  }

  const outputPath = resolve(
    repositoryRoot,
    outputArgumentIndex >= 0
      ? process.argv[outputArgumentIndex + 1]!
      : 'infra/docker-compose/.env'
  );

  if (!existsSync(examplePath)) {
    throw new Error(`Required self-host environment template not found: ${examplePath}`);
  }

  const content = renderSelfhostEnvironment(readFileSync(examplePath, 'utf8'));

  try {
    writeFileSync(outputPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Refusing to overwrite existing configuration: ${outputPath}`);
    }
    throw error;
  }

  console.log(JSON.stringify({ ok: true, configPath: outputPath }));
};

if (import.meta.main) {
  main();
}
