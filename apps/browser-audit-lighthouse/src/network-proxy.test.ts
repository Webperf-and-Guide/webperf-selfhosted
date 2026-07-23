import { afterEach, describe, expect, test } from 'bun:test';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { startBrowserNetworkProxy, type BrowserNetworkProxy } from './network-proxy';

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
    const proxy = await startBrowserNetworkProxy({
      lookupHost: async () => [{ address: '169.254.169.254', family: 4 }],
      connectTarget: () => {
        connected = true;
        throw new Error('must not connect');
      }
    });
    proxies.push(proxy);

    expect(await sendConnect(proxy.port, 'metadata.example:443')).toStartWith(
      'HTTP/1.1 502'
    );
    expect(connected).toBe(false);
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

const sendConnect = async (port: number, authority: string) =>
  await new Promise<string>((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    sockets.push(socket);
    let response = '';
    socket.setEncoding('utf8');
    socket.once('error', reject);
    socket.on('data', (chunk) => {
      response += chunk;
      if (response.includes('\r\n\r\n')) {
        resolve(response);
      }
    });
    socket.once('connect', () => {
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
    });
  });
