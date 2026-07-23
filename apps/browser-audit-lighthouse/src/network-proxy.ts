import {
  createServer,
  request as createHttpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse
} from 'node:http';
import { connect, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import {
  resolveBrowserRequestTarget,
  type LookupHost
} from './network-policy';

const proxyHost = '127.0.0.1';
const connectTimeoutMs = 10_000;
const httpIdleTimeoutMs = 30_000;
const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

export type BrowserNetworkProxy = {
  url: string;
  port: number;
  close(): Promise<void>;
};
type ConnectTarget = (options: {
  host: string;
  family: 4 | 6;
  port: number;
}) => Socket;

export const startBrowserNetworkProxy = async ({
  allowlist = [],
  lookupHost,
  connectTarget = (options) => connect(options)
}: {
  allowlist?: string[];
  lookupHost?: LookupHost;
  connectTarget?: ConnectTarget;
} = {}): Promise<BrowserNetworkProxy> => {
  const sockets = new Set<Socket>();
  const trackSocket = (socket: Socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    return socket;
  };

  const resolveTarget = (value: string) => resolveBrowserRequestTarget(value, {
    allowlist,
    ...(lookupHost ? { lookupHost } : {})
  });

  const server = createServer((request, response) => {
    void proxyHttpRequest(request, response, resolveTarget, trackSocket);
  });
  server.on('connect', (request, clientSocket, head) => {
    void proxyConnectRequest(
      request,
      clientSocket,
      head,
      resolveTarget,
      connectTarget,
      trackSocket
    );
  });
  server.on('upgrade', (_request, socket) => {
    socket.once('error', () => undefined);
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  });
  server.on('clientError', (_error, socket) => {
    socket.once('error', () => undefined);
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  server.on('connection', trackSocket);

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, proxyHost);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Browser network proxy did not bind a TCP port');
  }

  let closed = false;
  return {
    url: `http://${proxyHost}:${address.port}`,
    port: address.port,
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  };
};

const proxyHttpRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  resolveTarget: (value: string) => ReturnType<typeof resolveBrowserRequestTarget>,
  trackSocket: (socket: Socket) => Socket
) => {
  let upstream: ReturnType<typeof createHttpRequest> | null = null;
  request.once('error', () => upstream?.destroy());
  response.once('error', () => upstream?.destroy());

  try {
    if (!request.url) {
      throw new Error('Proxy request URL is missing');
    }
    const target = await resolveTarget(request.url);
    if (target.url.protocol !== 'http:') {
      throw new Error('HTTPS proxy requests must use CONNECT');
    }

    const headers = sanitizeHeaders(request.headers);
    headers.host = target.url.host;
    upstream = createHttpRequest({
      host: target.address,
      family: target.family,
      port: Number(target.url.port || '80'),
      method: request.method,
      path: `${target.url.pathname}${target.url.search}`,
      headers
    });
    const targetRequest = upstream;
    targetRequest.on('socket', trackSocket);
    targetRequest.setTimeout(
      httpIdleTimeoutMs,
      () => targetRequest.destroy(new Error('Browser proxy HTTP request timed out'))
    );
    targetRequest.once('response', (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        sanitizeHeaders(upstreamResponse.headers)
      );
      upstreamResponse.once('error', () => response.destroy());
      upstreamResponse.pipe(response);
    });
    targetRequest.once('error', () => sendProxyError(response));
    request.once('aborted', () => targetRequest.destroy());
    response.once('close', () => targetRequest.destroy());
    request.pipe(targetRequest);
  } catch {
    sendProxyError(response);
  }
};

const proxyConnectRequest = async (
  request: IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
  resolveTarget: (value: string) => ReturnType<typeof resolveBrowserRequestTarget>,
  connectTarget: ConnectTarget,
  trackSocket: (socket: Socket) => Socket
) => {
  let established = false;
  let upstream: Socket | null = null;
  clientSocket.once('error', () => upstream?.destroy());
  clientSocket.once('close', () => upstream?.destroy());

  try {
    const authority = request.url;
    if (!authority || authority.includes('/') || authority.includes('\\')) {
      throw new Error('Proxy CONNECT authority is invalid');
    }
    const target = await resolveTarget(`https://${authority}/`);
    upstream = trackSocket(connectTarget({
      host: target.address,
      family: target.family,
      port: Number(target.url.port || '443')
    }));
    const targetSocket = upstream;
    targetSocket.setTimeout(
      connectTimeoutMs,
      () => targetSocket.destroy(new Error('Browser proxy connection timed out'))
    );
    targetSocket.once('connect', () => {
      established = true;
      targetSocket.setTimeout(0);
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.byteLength > 0) {
        targetSocket.write(head);
      }
      clientSocket.pipe(targetSocket);
      targetSocket.pipe(clientSocket);
    });
    targetSocket.once('error', () => {
      if (established) {
        clientSocket.destroy();
      } else {
        sendConnectError(clientSocket);
      }
    });
  } catch {
    sendConnectError(clientSocket);
  }
};

const sanitizeHeaders = (headers: IncomingHttpHeaders): IncomingHttpHeaders =>
  Object.fromEntries(
    Object.entries(headers).filter(([name]) => !hopByHopHeaders.has(name.toLowerCase()))
  );

const sendProxyError = (response: ServerResponse) => {
  if (!response.headersSent) {
    response.writeHead(502, {
      connection: 'close',
      'content-type': 'text/plain; charset=utf-8'
    });
  }
  response.end('Browser request blocked by network policy');
};

const sendConnectError = (socket: Duplex) => {
  if (socket.writable) {
    socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
  } else {
    socket.destroy();
  }
};
