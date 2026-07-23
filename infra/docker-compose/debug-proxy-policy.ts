const hopByHopHeaders = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
] as const;

export const resolveDebugProxyUpstream = (
  target: URL,
  requestUrl: URL
) => {
  const upstreamUrl = new URL(target);
  upstreamUrl.pathname = requestUrl.pathname;
  upstreamUrl.search = requestUrl.search;
  upstreamUrl.hash = '';
  return upstreamUrl;
};

export const stripHopByHopHeaders = (headers: Headers) => {
  const connectionHeaders = (headers.get('connection') ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

  for (const name of [...connectionHeaders, ...hopByHopHeaders]) {
    headers.delete(name);
  }
};
