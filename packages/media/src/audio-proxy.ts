import { HttpsProxyAgent } from 'https-proxy-agent';

export class MediaAudioProxyError extends Error {
  constructor(readonly code: 'PROXY_AUTH_REQUIRED' | 'PROXY_UNAVAILABLE') {
    super(code === 'PROXY_AUTH_REQUIRED'
      ? 'Проксі YouTube відхилив авторизацію. Адміністратору потрібно перевірити налаштування проксі.'
      : 'Проксі YouTube недоступний. Адміністратору потрібно перевірити підключення проксі.');
  }
}

/** CONNECT only to a validated public destination; retain the origin's TLS identity. */
export function audioProxyAgent(proxyValue: string, address: string, hostname: string, signal?: AbortSignal) {
  const proxy = new URL(proxyValue);
  const credentials = proxy.username || proxy.password
    ? Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64') : undefined;
  // The dependency's DEBUG output includes proxy.href. Keep credentials out of that URL.
  proxy.username = ''; proxy.password = '';
  const connection = new AbortController();
  const connectionSignal = signal ? AbortSignal.any([signal, connection.signal]) : connection.signal;
  const agent = new HttpsProxyAgent(proxy, {
    signal: connectionSignal, family: 4,
    headers: credentials ? { 'Proxy-Authorization': `Basic ${credentials}` } : {},
  });
  let status: number | undefined;
  agent.on('proxyConnect', (response: { statusCode: number }) => { status = response.statusCode; });
  const connect = agent.connect.bind(agent);
  agent.connect = async (request, options) => {
    const timeout = setTimeout(() => connection.abort(), 8000);
    try {
      const destination = options.secureEndpoint
        ? { ...options, host: address, servername: hostname }
        : { ...options, host: address };
      const socket = await connect(request, destination);
      if (status !== 200 || request.destroyed || signal?.aborted) {
        socket.destroy(); throw new MediaAudioProxyError(status === 407 ? 'PROXY_AUTH_REQUIRED' : 'PROXY_UNAVAILABLE');
      }
      return socket;
    } catch {
      // Do not expose proxy URLs, credentials or an upstream server's error text.
      throw new MediaAudioProxyError(status === 407 ? 'PROXY_AUTH_REQUIRED' : 'PROXY_UNAVAILABLE');
    } finally { clearTimeout(timeout); }
  };
  return agent;
}
