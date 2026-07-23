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
  BrowserNetworkPolicyError,
  resolveBrowserRequestTarget,
  type LookupHost
} from './network-policy';

const proxyHost = '127.0.0.1';
const connectTimeoutMs = 10_000;
const httpIdleTimeoutMs = 30_000;
const defaultTunnelIdleTimeoutMs = 30_000;
const maximumDiagnostics = 20;
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
const proxySignalingHeaders = new Set([
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip'
]);

export type BrowserNetworkProxyDiagnostic = {
  event: 'http_request_failed' | 'connect_request_failed';
  reason: 'network_policy' | 'timeout' | 'transport';
  errorType: string;
  errorCode: string | null;
};

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
  connectTarget = (options) => connect(options),
  tunnelIdleTimeoutMs = defaultTunnelIdleTimeoutMs,
  onDiagnostic
}: {
  allowlist?: string[];
  lookupHost?: LookupHost;
  connectTarget?: ConnectTarget;
  tunnelIdleTimeoutMs?: number;
  onDiagnostic?: (diagnostic: BrowserNetworkProxyDiagnostic) => void;
} = {}): Promise<BrowserNetworkProxy> => {
  if (
    !Number.isSafeInteger(tunnelIdleTimeoutMs)
    || tunnelIdleTimeoutMs < 1
    || tunnelIdleTimeoutMs > 300_000
  ) {
    throw new Error('Browser proxy tunnel idle timeout must be between 1 and 300000ms');
  }

  const sockets = new Set<Socket>();
  let diagnosticCount = 0;
  const reportDiagnostic = (
    event: BrowserNetworkProxyDiagnostic['event'],
    error: unknown
  ) => {
    if (!onDiagnostic || diagnosticCount >= maximumDiagnostics) {
      return;
    }
    diagnosticCount += 1;
    try {
      onDiagnostic(describeProxyError(event, error));
    } catch {
      // Observability hooks must never weaken proxy enforcement.
    }
  };
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
    void proxyHttpRequest(
      request,
      response,
      resolveTarget,
      trackSocket,
      reportDiagnostic
    );
  });
  server.on('connect', (request, clientSocket, head) => {
    void proxyConnectRequest(
      request,
      clientSocket,
      head,
      resolveTarget,
      connectTarget,
      trackSocket,
      tunnelIdleTimeoutMs,
      reportDiagnostic
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
  trackSocket: (socket: Socket) => Socket,
  reportDiagnostic: (
    event: BrowserNetworkProxyDiagnostic['event'],
    error: unknown
  ) => void
) => {
  request.once('error', (error) => {
    reportDiagnostic('http_request_failed', error);
    response.destroy();
  });
  response.once('error', () => request.destroy());

  try {
    if (!request.url) {
      throw new Error('Proxy request URL is missing');
    }
    const target = await resolveTarget(request.url);
    if (target.url.protocol !== 'http:') {
      throw new Error('HTTPS proxy requests must use CONNECT');
    }
    if (request.destroyed || response.destroyed) {
      return;
    }

    const headers = sanitizeProxyHeaders(request.headers);
    headers.host = target.url.host;
    const upstream = createHttpRequest({
      host: target.address,
      family: target.family,
      port: Number(target.url.port || '80'),
      method: request.method,
      path: `${target.url.pathname}${target.url.search}`,
      headers
    });
    upstream.on('socket', trackSocket);
    upstream.setTimeout(
      httpIdleTimeoutMs,
      () => upstream.destroy(new Error('Browser proxy HTTP request timed out'))
    );
    upstream.once('response', (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        sanitizeProxyHeaders(upstreamResponse.headers)
      );
      upstreamResponse.once('error', (error) => {
        reportDiagnostic('http_request_failed', error);
        response.destroy();
      });
      upstreamResponse.pipe(response);
    });
    upstream.once('error', (error) => {
      reportDiagnostic('http_request_failed', error);
      sendProxyError(response);
    });
    request.once('aborted', () => upstream.destroy());
    response.once('close', () => upstream.destroy());
    request.pipe(upstream);
  } catch (error) {
    reportDiagnostic('http_request_failed', error);
    sendProxyError(response);
  }
};

const proxyConnectRequest = async (
  request: IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
  resolveTarget: (value: string) => ReturnType<typeof resolveBrowserRequestTarget>,
  connectTarget: ConnectTarget,
  trackSocket: (socket: Socket) => Socket,
  tunnelIdleTimeoutMs: number,
  reportDiagnostic: (
    event: BrowserNetworkProxyDiagnostic['event'],
    error: unknown
  ) => void
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
      targetSocket.setTimeout(
        tunnelIdleTimeoutMs,
        () => targetSocket.destroy(new Error('Browser proxy tunnel timed out'))
      );
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.byteLength > 0) {
        targetSocket.write(head);
      }
      clientSocket.pipe(targetSocket);
      targetSocket.pipe(clientSocket);
    });
    targetSocket.once('error', (error) => {
      reportDiagnostic('connect_request_failed', error);
      if (established) {
        clientSocket.destroy();
      } else {
        sendConnectError(clientSocket);
      }
    });
  } catch (error) {
    reportDiagnostic('connect_request_failed', error);
    sendConnectError(clientSocket);
  }
};

export const sanitizeProxyHeaders = (headers: IncomingHttpHeaders): IncomingHttpHeaders =>
  Object.fromEntries(
    Object.entries(headers).filter(([name]) => {
      const normalized = name.toLowerCase();
      return !hopByHopHeaders.has(normalized) && !proxySignalingHeaders.has(normalized);
    })
  );

const sendProxyError = (response: ServerResponse) => {
  if (response.destroyed || response.headersSent) {
    if (!response.destroyed && !response.writableEnded) {
      response.destroy();
    }
    return;
  }
  response.writeHead(502, {
    connection: 'close',
    'content-type': 'text/plain; charset=utf-8'
  });
  response.end('Browser request blocked by network policy');
};

const sendConnectError = (socket: Duplex) => {
  if (socket.writable) {
    socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
  } else {
    socket.destroy();
  }
};

const describeProxyError = (
  event: BrowserNetworkProxyDiagnostic['event'],
  error: unknown
): BrowserNetworkProxyDiagnostic => {
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown } | null;
  const errorType = typeof candidate?.name === 'string'
    && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(candidate.name)
      ? candidate.name
      : 'UnknownError';
  const errorCode = typeof candidate?.code === 'string'
    && /^[A-Z][A-Z0-9_]{0,79}$/.test(candidate.code)
      ? candidate.code
      : null;
  let reason: BrowserNetworkProxyDiagnostic['reason'] = 'transport';
  if (error instanceof BrowserNetworkPolicyError) {
    reason = 'network_policy';
  } else if (
    typeof candidate?.message === 'string'
    && /timed out/i.test(candidate.message)
  ) {
    reason = 'timeout';
  }

  return { event, reason, errorType, errorCode };
};
