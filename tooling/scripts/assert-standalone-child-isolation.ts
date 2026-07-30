#!/usr/bin/env bun

import { readFile, readdir } from 'node:fs/promises';

import {
  standaloneChildCommands,
  standaloneChildIdentities
} from './webperf-standalone-config';

type ServiceName = keyof typeof standaloneChildIdentities;

const services = Object.keys(standaloneChildCommands) as ServiceName[];
const entrypointServices = new Map<string, ServiceName>();
for (const service of services) {
  const entrypoint = standaloneChildCommands[service].at(-1);
  if (!entrypoint) {
    throw new Error(`Standalone ${service} command must include an entrypoint`);
  }
  const existingService = entrypointServices.get(entrypoint);
  if (existingService) {
    throw new Error(
      `Standalone entrypoint ${entrypoint} is shared by ${existingService} and ${service}`
    );
  }
  entrypointServices.set(entrypoint, service);
}
const executorEntrypoint = standaloneChildCommands.executor.at(-1);
if (!executorEntrypoint) {
  throw new Error('Standalone executor command must include an entrypoint');
}
const processGoneCodes = new Set(['ENOENT', 'ESRCH']);
const credentialIsolationCodes = new Set(['EACCES', 'EPERM']);
const identityPatterns = {
  Uid: /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m,
  Gid: /^Gid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m
} as const;

const hasErrorCode = (
  error: unknown,
  codes: ReadonlySet<string>
): error is NodeJS.ErrnoException =>
  error instanceof Error
  && typeof (error as NodeJS.ErrnoException).code === 'string'
  && codes.has((error as NodeJS.ErrnoException).code as string);

const readProcessFile = async (
  processId: string,
  filename: 'cmdline' | 'status'
): Promise<string | null> => {
  try {
    return await readFile(`/proc/${processId}/${filename}`, 'utf8');
  } catch (error) {
    if (hasErrorCode(error, processGoneCodes)) {
      return null;
    }
    throw new Error(`Failed to inspect process ${processId} ${filename}`, { cause: error });
  }
};

const parseIdentityFields = (
  status: string,
  field: 'Uid' | 'Gid',
  processId: string,
  service: ServiceName
): number[] => {
  const values = status.match(identityPatterns[field])?.slice(1).map(Number);
  if (!values || values.length !== 4 || values.some((value) => !Number.isSafeInteger(value))) {
    throw new Error(`Failed to parse /proc/${processId}/status ${field} fields for ${service}`);
  }
  return values;
};

const inspectChildren = async (): Promise<void> => {
  const found: { service: ServiceName; processId: number }[] = [];

  // Keep /proc reads sequential so the smoke check cannot create an unbounded file-descriptor burst.
  for (const processId of await readdir('/proc')) {
    if (!/^\d+$/.test(processId)) {
      continue;
    }
    const rawCommand = await readProcessFile(processId, 'cmdline');
    if (rawCommand === null) {
      continue;
    }
    const command = rawCommand.split('\0').filter(Boolean);
    const service = command
      .map((argument) => entrypointServices.get(argument))
      .find((candidate): candidate is ServiceName => candidate !== undefined);
    if (!service) {
      continue;
    }
    const status = await readProcessFile(processId, 'status');
    if (status === null) {
      throw new Error(`${service} exited before the isolation check completed`);
    }
    const identity = standaloneChildIdentities[service];
    const uids = parseIdentityFields(status, 'Uid', processId, service);
    const gids = parseIdentityFields(status, 'Gid', processId, service);
    if (
      uids.some((uid) => uid !== identity.uid)
      || gids.some((gid) => gid !== identity.gid)
    ) {
      throw new Error(
        `Unexpected ${service} child identity: ${JSON.stringify({ processId, uids, gids })}`
      );
    }
    found.push({ service, processId: Number(processId) });
  }

  const expected = new Set<ServiceName>(services);
  const foundNames = new Set(found.map(({ service }) => service));
  if (found.length !== expected.size || foundNames.size !== expected.size) {
    const missing = [...expected].filter((service) => !foundNames.has(service));
    const counts = found.reduce(
      (result, { service }) => result.set(service, (result.get(service) ?? 0) + 1),
      new Map<ServiceName, number>()
    );
    const duplicates = [...counts]
      .filter(([, count]) => count > 1)
      .map(([service]) => service);
    const details = [
      missing.length > 0 ? `missing: ${missing.join(', ')}` : '',
      duplicates.length > 0 ? `duplicates: ${duplicates.join(', ')}` : ''
    ].filter(Boolean).join('; ');
    throw new Error(
      `Standalone child isolation failed (${details || 'unexpected process set'}); `
      + `found ${JSON.stringify(found)}`
    );
  }

  const executor = found.find(({ service }) => service === 'executor');
  if (!executor) {
    throw new Error('Executor identity was not found after standalone child validation');
  }
  const consoleIdentity = standaloneChildIdentities.console;
  console.log([executor.processId, consoleIdentity.uid, consoleIdentity.gid].join('\t'));
};

const verifyCredentialIsolation = async (processId: string | undefined): Promise<void> => {
  if (!processId || !/^[1-9]\d*$/.test(processId)) {
    throw new Error('verify requires a positive executor process ID');
  }
  const processDirectory = `/proc/${processId}`;
  let command: string[];
  try {
    command = (await readFile(`${processDirectory}/cmdline`, 'utf8'))
      .split('\0')
      .filter(Boolean);
  } catch (error) {
    if (hasErrorCode(error, processGoneCodes)) {
      throw new Error('Executor exited before the isolation check completed', { cause: error });
    }
    throw new Error('Unable to verify the executor PID identity', { cause: error });
  }
  if (!command.includes(executorEntrypoint)) {
    throw new Error('Executor PID identity changed before the isolation check completed');
  }

  try {
    // Only the access result matters; the credential-bearing content is intentionally discarded.
    await readFile(`${processDirectory}/environ`, 'utf8');
  } catch (error) {
    if (hasErrorCode(error, credentialIsolationCodes)) {
      return;
    }
    if (hasErrorCode(error, processGoneCodes)) {
      throw new Error('Executor exited before the isolation check completed', { cause: error });
    }
    throw new Error(
      'Unexpected error while verifying executor credential isolation',
      { cause: error }
    );
  }
  throw new Error(
    `Console identity could read executor process credentials (PID ${processId})`
  );
};

const command = process.argv[2];
if (command === 'inspect') {
  await inspectChildren();
} else if (command === 'verify') {
  await verifyCredentialIsolation(process.argv[3]);
} else {
  throw new Error('Usage: assert-standalone-child-isolation.ts <inspect|verify> [executor-pid]');
}
