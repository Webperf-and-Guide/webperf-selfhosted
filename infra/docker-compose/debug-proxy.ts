import {
  DebugProxyRequestBodyTooLargeError,
  maximumDebugProxyRequestBytes,
  readBoundedDebugProxyBody,
  resolveDebugProxyUpstream,
  stripHopByHopHeaders
} from './debug-proxy-policy';

function readTarget() {
  const value = process.env.DEBUG_PROXY_TARGET?.trim();

  if (!value) {
    throw new Error('DEBUG_PROXY_TARGET is required');
  }

  const parsed = new URL(value);

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('DEBUG_PROXY_TARGET must be an HTTP(S) origin without credentials');
  }

  parsed.pathname = '/';
  parsed.search = '';
  parsed.hash = '';
  return parsed;
}

function readPort() {
  const value = Number(process.env.DEBUG_PROXY_PORT ?? '8789');

  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error('DEBUG_PROXY_PORT must be a valid TCP port');
  }

  return value;
}

function readErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('cause' in error)) {
    return null;
  }

  const cause = error.cause;
  return cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
    ? cause.code
    : null;
}

const target = readTarget();
const port = readPort();

Bun.serve({
  hostname: '0.0.0.0',
  port,
  async fetch(request) {
    const requestUrl = new URL(request.url);
    const upstreamUrl = resolveDebugProxyUpstream(target, requestUrl);
    const headers = new Headers(request.headers);
    stripHopByHopHeaders(headers);
    headers.delete('host');

    try {
      const body = request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await readBoundedDebugProxyBody(request, maximumDebugProxyRequestBytes);
      const upstreamResponse = await fetch(upstreamUrl, {
        method: request.method,
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)])
      });
      const responseHeaders = new Headers(upstreamResponse.headers);
      stripHopByHopHeaders(responseHeaders);
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders
      });
    } catch (error) {
      if (error instanceof DebugProxyRequestBodyTooLargeError) {
        return Response.json({ error: 'Debug request body too large' }, { status: 413 });
      }

      console.error(
        JSON.stringify({
          service: 'webperf-debug-proxy',
          event: 'upstream_request_failed',
          target: target.origin,
          method: request.method,
          path: requestUrl.pathname,
          errorType: error instanceof Error ? error.name : 'UnknownError',
          // Raw network messages can echo query secrets or internal addresses.
          errorCode: readErrorCode(error)
        })
      );
      return Response.json({ error: 'Debug target unavailable' }, { status: 502 });
    }
  }
});

console.log(
  JSON.stringify({
    service: 'webperf-debug-proxy',
    target: target.origin,
    port
  })
);
