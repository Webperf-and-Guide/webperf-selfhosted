import { afterEach, describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:http';
import {
  createPinnedHttpRequest,
  OutboundHttpPolicyError,
  resolveOutboundHttpTarget
} from './outbound-http';

const servers = new Set<Server>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  servers.clear();
});

describe('executor pinned outbound HTTP', () => {
  test('rejects private, mixed, and IPv4-mapped DNS answers for public targets', async () => {
    for (const addresses of [
      [{ address: '10.0.0.4', family: 4 }],
      [
        { address: '93.184.216.34', family: 4 },
        { address: '169.254.169.254', family: 4 }
      ],
      [{ address: '::ffff:127.0.0.1', family: 6 }]
    ]) {
      await expect(resolveOutboundHttpTarget('https://hooks.example.test/delivery', {
        addressPolicy: 'public',
        lookupHost: async () => addresses
      })).rejects.toMatchObject({
        name: 'OutboundHttpPolicyError',
        code: 'address_blocked'
      });
    }
  });

  test('requires every loopback hostname answer to stay in loopback space', async () => {
    await expect(resolveOutboundHttpTarget('http://localhost:8080/measure', {
      addressPolicy: 'loopback',
      lookupHost: async () => [{ address: '127.42.0.8', family: 4 }]
    })).resolves.toMatchObject({
      address: '127.42.0.8',
      family: 4
    });

    await expect(resolveOutboundHttpTarget('http://localhost:8080/measure', {
      addressPolicy: 'loopback',
      lookupHost: async () => [{ address: '93.184.216.34', family: 4 }]
    })).rejects.toBeInstanceOf(OutboundHttpPolicyError);
  });

  test('connects to the validated IP while preserving the original Host header', async () => {
    let receivedHost: string | undefined;
    const server = createServer((request, response) => {
      receivedHost = request.headers.host;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
    });
    servers.add(server);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not expose a TCP port');
    }

    const request = createPinnedHttpRequest({
      lookupHost: async () => [{ address: '127.0.0.1', family: 4 }]
    });
    const response = await request(
      new URL(`http://probe.example.test:${address.port}/measure?source=test`),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        signal: new AbortController().signal,
        addressPolicy: 'any'
      }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(receivedHost).toBe(`probe.example.test:${address.port}`);
  });

  test('bounds response bodies from untrusted peers', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('response-is-too-large');
    });
    servers.add(server);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not expose a TCP port');
    }

    const request = createPinnedHttpRequest();
    await expect(request(new URL(`http://127.0.0.1:${address.port}/`), {
      method: 'GET',
      signal: new AbortController().signal,
      addressPolicy: 'loopback',
      maximumResponseBytes: 4
    })).rejects.toMatchObject({ code: 'ERR_RESPONSE_TOO_LARGE' });
  });
});
