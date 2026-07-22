const target = readTarget();
const port = readPort();

Bun.serve({
  hostname: '0.0.0.0',
  port,
  async fetch(request) {
    const requestUrl = new URL(request.url);
    const upstreamUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, target);
    const headers = new Headers(request.headers);

    for (const name of ['connection', 'host', 'keep-alive', 'transfer-encoding', 'upgrade']) {
      headers.delete(name);
    }

    try {
      return await fetch(upstreamUrl, {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        redirect: 'manual'
      });
    } catch {
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
