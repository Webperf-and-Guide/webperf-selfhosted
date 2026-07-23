import { afterEach, describe, expect, test } from 'bun:test';
import { createServer, connect, type Server, type Socket } from 'node:net';
import {
  sanitizeProxyHeaders,
  startBrowserNetworkProxy,
  validateConnectAuthority,
  type BrowserNetworkProxy,
  type BrowserNetworkProxyDiagnostic
} from './network-proxy';

const proxies: BrowserNetworkProxy[] = [];
const servers: Server[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.destroy();
  }
  for (const proxy of proxies.splice(0)) {
    await proxy.close();
  }
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe('browser audit pinned network proxy', () => {
  test('connects to the validated address without resolving the hostname again', async () => {
    const upstream = await listenTcpServer();
    const connections: Array<{ host: string; family: 4 | 6; port: number }> = [];
    let lookups = 0;
    const proxy = await startBrowserNetworkProxy({
      lookupHost: async (hostname) => {
        lookups += 1;
        expect(hostname).toBe('rebind.example');
        return [{ address: '93.184.216.34', family: 4 }];
      },
      connectTarget: (options) => {
        connections.push(options);
        return connect({ host: '127.0.0.1', port: upstream.port });
      }
    });
    proxies.push(proxy);

    const response = await sendConnect(proxy.port, 'rebind.example:443');
    expect(response).toStartWith('HTTP/1.1 200');
    expect(lookups).toBe(1);
    expect(connections).toEqual([{
      host: '93.184.216.34',
      family: 4,
      port: 443
    }]);
  });

  test('rejects a private DNS answer before opening a tunnel', async () => {
    let connected = false;
    const diagnostics: BrowserNetworkProxyDiagnostic[] = [];
    const proxy = await startBrowserNetworkProxy({
      lookupHost: async () => [{ address: '169.254.169.254', family: 4 }],
      connectTarget: () => {
        connected = true;
        throw new Error('must not connect');
      },
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
    });
    proxies.push(proxy);

    expect(await sendConnect(proxy.port, 'metadata.example:443')).toStartWith(
      'HTTP/1.1 502'
    );
    expect(connected).toBe(false);
    expect(diagnostics).toEqual([{
      event: 'connect_request_failed',
      reason: 'network_policy',
      errorType: 'BrowserNetworkPolicyError',
      errorCode: null
    }]);
  });

  test('classifies credential and alternate-port violations as network policy failures', async () => {
    const diagnostics: BrowserNetworkProxyDiagnostic[] = [];
    const proxy = await startBrowserNetworkProxy({
      lookupHost: async () => [{ address: '93.184.216.34', family: 4 }],
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
    });
    proxies.push(proxy);

    expect(await sendConnect(proxy.port, 'user:pass@example.com:443'))
      .toStartWith('HTTP/1.1 502');
    expect(await sendConnect(proxy.port, 'example.com:8443')).toStartWith('HTTP/1.1 502');
    expect(diagnostics.map(({ reason }) => reason)).toEqual([
      'network_policy',
      'network_policy'
    ]);
  });

  test('strips proxy identity headers before forwarding', () => {
    expect(sanitizeProxyHeaders({
      host: 'example.com',
      connection: 'keep-alive',
      forwarded: 'for=10.0.0.1',
      'x-forwarded-for': '10.0.0.1',
      'x-forwarded-host': 'internal.example',
      'x-forwarded-proto': 'https',
      'x-real-ip': '10.0.0.1',
      accept: 'text/html'
    })).toEqual({
      host: 'example.com',
      accept: 'text/html'
    });
  });

  test('removes content length when transfer decoding changes the body framing', () => {
    expect(sanitizeProxyHeaders({
      'transfer-encoding': 'chunked',
      'content-length': '999',
      'content-type': 'text/plain'
    })).toEqual({
      'content-type': 'text/plain'
    });
    expect(sanitizeProxyHeaders({
      'content-length': '12',
      'content-type': 'text/plain'
    })).toEqual({
      'content-length': '12',
      'content-type': 'text/plain'
    });
  });

  test('bounds and rejects ambiguous CONNECT authorities', () => {
    expect(validateConnectAuthority('example.com:443')).toBe('example.com:443');
    for (const authority of [
      'example.com :443',
      'example.com/other:443',
      'example.com\\other:443',
      `example.com\u0000:443`,
      `${'a'.repeat(513)}:443`
    ]) {
      expect(() => validateConnectAuthority(authority)).toThrow('authority is invalid');
    }
  });

  test('does not connect after the client closes during DNS resolution', async () => {
    let releaseLookup!: (addresses: Array<{ address: string; family: number }>) => void;
    let markLookupStarted!: () => void;
    const lookupStarted = new Promise<void>((resolve) => {
      markLookupStarted = resolve;
    });
    const lookupResult = new Promise<Array<{ address: string; family: number }>>((resolve) => {
      releaseLookup = resolve;
    });
    let connected = false;
    const proxy = await startBrowserNetworkProxy({
      lookupHost: async () => {
        markLookupStarted();
        return await lookupResult;
      },
      connectTarget: () => {
        connected = true;
        throw new Error('must not connect after the client closes');
      }
    });
    proxies.push(proxy);

    const socket = connect({ host: '127.0.0.1', port: proxy.port });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.once('connect', resolve);
    });
    socket.write('CONNECT delayed.example:443 HTTP/1.1\r\nHost: delayed.example:443\r\n\r\n');
    await lookupStarted;
    socket.end();
    await Bun.sleep(20);
    releaseLookup([{ address: '93.184.216.34', family: 4 }]);
    await waitForSocketClose(socket);

    expect(connected).toBe(false);
  });

  test('closes established CONNECT tunnels after the idle deadline', async () => {
    const upstream = await listenTcpServer();
    const proxy = await startBrowserNetworkProxy({
      lookupHost: async () => [{ address: '93.184.216.34', family: 4 }],
      connectTarget: () => connect({ host: '127.0.0.1', port: upstream.port }),
      tunnelIdleTimeoutMs: 20
    });
    proxies.push(proxy);

    const tunnel = await openConnect(proxy.port, 'idle.example:443');
    expect(tunnel.response).toStartWith('HTTP/1.1 200');
    await waitForSocketClose(tunnel.socket);
    expect(tunnel.socket.destroyed).toBe(true);
  });
});

const listenTcpServer = async () => {
  const server = createServer((socket) => sockets.push(socket));
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test TCP server did not bind');
  }
  return { port: address.port };
};

const openConnect = async (port: number, authority: string) =>
  await new Promise<{ response: string; socket: Socket }>((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    sockets.push(socket);
    let response = '';
    socket.setEncoding('utf8');
    socket.once('error', reject);
    socket.on('data', (chunk) => {
      response += chunk;
      if (response.includes('\r\n\r\n')) {
        resolve({ response, socket });
      }
    });
    socket.once('connect', () => {
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
    });
  });

const sendConnect = async (port: number, authority: string) =>
  (await openConnect(port, authority)).response;

const waitForSocketClose = async (socket: Socket) => {
  if (socket.destroyed) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for CONNECT tunnel to close')),
      500
    );
    socket.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
};
