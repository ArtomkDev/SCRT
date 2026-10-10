import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [['2001::', 32], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) blocked.addSubnet(address, prefix, 'ipv6');
export function isPublicMediaAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, 'ipv4') : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}
export function validateMediaUrl(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || (url.port && !['80', '443'].includes(url.port)) || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host === 'metadata.google.internal') throw new Error('Недозволена адреса аудіо.');
  if (isIP(host) && !isPublicMediaAddress(host)) throw new Error('Приватні адреси аудіо заборонені.');
  return url;
}
export type MediaDnsLookup = (host: string) => Promise<Array<{ address: string; family: number }>>;
function audioTimeout(message: string): Error & { code: string } { return Object.assign(new Error(message), { code: 'ETIMEDOUT' }); }
export class MediaAudioHttpError extends Error {
  constructor(readonly status: number) { super('Джерело не повернуло доступний аудіопотік.'); }
}
export async function mediaDestination(value: string, resolve: MediaDnsLookup = (host) => lookup(host, { all: true, verbatim: true })): Promise<{ url: URL; address: string; family: number }> {
  const url = validateMediaUrl(value);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await Promise.race([
    resolve(host), new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(audioTimeout('DNS timeout')), 5000); timer.unref(); }),
  ]);
  if (!addresses.length || addresses.some((entry) => !isPublicMediaAddress(entry.address))) throw new Error('DNS адреса аудіо недозволена.');
  return { url, ...addresses[0]! };
}
export async function openAudioStream(value: string, signal?: AbortSignal, redirects = 0, resolve?: MediaDnsLookup, headers: Record<string, string> = {}): Promise<IncomingMessage> {
  if (redirects > 3) throw new Error('Забагато переадресацій аудіо.');
  const { url, address, family } = await mediaDestination(value, resolve);
  const response = await new Promise<IncomingMessage>((accept, reject) => {
    const options: RequestOptions & { autoSelectFamily: boolean } = {
      signal, autoSelectFamily: false, family, headers: { Accept: 'audio/*, application/ogg', 'User-Agent': 'SCRT-Media/1', ...headers },
      // Pin the validated DNS address for this connection; TLS verifies the original hostname.
      lookup: (_host, _options, callback) => callback(null, address, family),
    };
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, options, accept);
    const deadline = setTimeout(() => req.destroy(audioTimeout('Audio connection timeout')), 8000);
    req.once('response', () => clearTimeout(deadline));
    req.once('error', (error) => { clearTimeout(deadline); reject(error); });
    req.setTimeout(15000, () => req.destroy(audioTimeout('Audio read timeout')));
    req.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
    response.destroy();
    if (!response.headers.location) throw new Error('Invalid audio redirect');
    return openAudioStream(new URL(response.headers.location, url).href, signal, redirects + 1, resolve, headers);
  }
  const contentType = String(response.headers['content-type'] ?? '').split(';')[0]!.toLowerCase();
  if (response.statusCode !== 200) {
    response.destroy(); throw new MediaAudioHttpError(response.statusCode ?? 0);
  }
  if (!(/^audio\/(mpeg|mp3|aac|aacp|ogg|opus|wav|wave|x-wav|flac|x-flac|mp4|webm)$/.test(contentType) || contentType === 'application/ogg')) {
    response.destroy(); throw new Error('Джерело не повернуло підтримуваний аудіопотік.');
  }
  return response;
}
