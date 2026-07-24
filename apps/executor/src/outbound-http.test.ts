import { afterEach, describe, expect, test } from 'bun:test';
import { createServer } from 'node:http';
import { createServer as createNetServer, type Server } from 'node:net';
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
  test('rejects invalid factory deadlines before the first request', () => {
    expect(() => createPinnedHttpRequest({ requestTimeoutMs: 0 }))
      .toThrow('Outbound HTTP request timeout');
    expect(() => createPinnedHttpRequest({ lookupTimeoutMs: 0 }))
      .toThrow('Outbound DNS lookup timeout');
  });

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
      lookupHost: async () => [{ address: '::1', family: 6 }]
    })).resolves.toMatchObject({
      address: '::1',
      family: 6
    });
    await expect(resolveOutboundHttpTarget('http://localhost:8080/measure', {
      addressPolicy: 'loopback',
      lookupHost: async () => [{ address: '0:0:0:0:0:0:0:1', family: 6 }]
    })).resolves.toMatchObject({ family: 6 });

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
        addressPolicy: 'loopback'
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

  test('settles an incomplete response stream without waiting for its deadline', async () => {
    const server = createNetServer((socket) => {
      socket.once('data', () => {
        socket.end('HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial');
      });
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

    const request = createPinnedHttpRequest({ requestTimeoutMs: 5_000 });
    await expect(request(new URL(`http://127.0.0.1:${address.port}/`), {
      method: 'GET',
      signal: new AbortController().signal,
      addressPolicy: 'loopback'
    })).rejects.toMatchObject({ code: 'ECONNRESET' });
  });

  test('limits trusted private origins to LAN space instead of all reserved addresses', async () => {
    await expect(resolveOutboundHttpTarget('http://probe:8080/measure', {
      addressPolicy: 'trusted-private',
      lookupHost: async () => [{ address: '172.18.0.4', family: 4 }]
    })).resolves.toMatchObject({ address: '172.18.0.4' });
    await expect(resolveOutboundHttpTarget('http://probe:8080/measure', {
      addressPolicy: 'trusted-private',
      lookupHost: async () => [{ address: 'fd00::4', family: 6 }]
    })).resolves.toMatchObject({ address: 'fd00::4' });

    for (const address of ['127.0.0.1', '169.254.169.254', '198.18.0.1']) {
      await expect(resolveOutboundHttpTarget('http://probe:8080/measure', {
        addressPolicy: 'trusted-private',
        lookupHost: async () => [{ address, family: 4 }]
      })).rejects.toMatchObject({ code: 'address_blocked' });
    }
  });
});
