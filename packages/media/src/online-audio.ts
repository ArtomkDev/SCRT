import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import type { MediaProviderHealth, MediaTrack } from '@scrt/shared';
import { mediaTrackSchema } from '@scrt/validation';
import { openAudioStream, validateMediaUrl } from './audio-http';
import type { MediaSourceProvider } from './providers';

type OnlineProviderId = 'youtube' | 'soundcloud';
const names = { youtube: 'YouTube', soundcloud: 'SoundCloud' };
const detailsSchema = z.object({
  id: z.string(), title: z.string(), uploader: z.string().nullish(), artist: z.string().nullish(),
  duration: z.number().nonnegative().nullish(), thumbnail: z.string().nullish(),
  webpage_url: z.string(), url: z.string().optional(), protocol: z.string().optional(),
  is_live: z.boolean().optional(), availability: z.string().nullish(), age_limit: z.number().optional(),
  http_headers: z.record(z.string(), z.string()).optional(),
});
type AudioDetails = z.infer<typeof detailsSchema>;
export interface OnlineAudioExtractor {
  available(): boolean;
  inspect(provider: OnlineProviderId, reference: string, signal?: AbortSignal): Promise<AudioDetails>;
  search(provider: OnlineProviderId, query: string, page?: number): Promise<AudioDetails[]>;
}
export class MediaSourceError extends Error {}

export function youtubeReference(value: string): string {
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  const url = validateMediaUrl(value);
  const host = url.hostname;
  const id = host === 'youtu.be' ? url.pathname.slice(1)
    : ['youtube.com', 'www.youtube.com', 'music.youtube.com', 'm.youtube.com'].includes(host)
      ? url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})\/?$/)?.[1]
      : null;
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) throw new MediaSourceError('Вставте посилання на окремий трек або відео YouTube.');
  return id;
}
export function soundcloudReference(value: string): string {
  const url = validateMediaUrl(value);
  if (!['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'].includes(url.hostname)
    || !/^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
    || /^\/(?:discover|search|you|charts)\//.test(url.pathname)) throw new MediaSourceError('Вставте посилання на окремий публічний трек SoundCloud.');
  return `https://soundcloud.com${url.pathname.replace(/\/$/, '')}`;
}
function canonical(provider: OnlineProviderId, reference: string): string {
  return provider === 'youtube' ? `https://www.youtube.com/watch?v=${youtubeReference(reference)}` : soundcloudReference(reference);
}
function publicTrack(provider: OnlineProviderId, value: AudioDetails): MediaTrack {
  const externalUrl = canonical(provider, value.webpage_url);
  const restricted = Boolean(value.availability && !['public', 'unlisted'].includes(value.availability)) || (value.age_limit ?? 0) >= 18;
  return mediaTrackSchema.parse({
    provider, providerItemId: provider === 'youtube' ? youtubeReference(externalUrl) : externalUrl,
    title: value.title.slice(0, 300), artist: (value.artist || value.uploader || names[provider]).slice(0, 200),
    durationMs: value.duration ? Math.round(value.duration * 1000) : null, type: value.is_live ? 'live' : 'track',
    artworkUrl: value.thumbnail ? validateMediaUrl(value.thumbnail).href : null,
    externalUrl, playable: !restricted && Boolean(value.url), seekable: false, explicit: null,
  });
}
export function extractorExecutable(cwd = process.cwd()): string {
  const filename = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const local = join(cwd, '.media-tools', filename);
  return existsSync(local) ? local : join(cwd, 'apps', 'bot', '.media-tools', filename);
}
function extractionError(provider: OnlineProviderId, stderr: string): MediaSourceError {
  if (/confirm you.re not a bot|sign in|login required|cookies/i.test(stderr)) return new MediaSourceError(`${names[provider]} вимагає авторизації для цього запиту. Публічний аудіопотік недоступний з мережі бота.`);
  if (/private|unavailable|not available|not found|404|removed|restricted|geo/i.test(stderr)) return new MediaSourceError('Трек недоступний: видалений, приватний або має обмеження доступу.');
  return new MediaSourceError('Не вдалося отримати аудіо з цього джерела. Спробуйте пізніше або інший трек.');
}
export class YtDlpExtractor implements OnlineAudioExtractor {
  private active = 0;
  constructor(private readonly executable = extractorExecutable()) {}
  available() { return existsSync(this.executable); }
  private async execute(provider: OnlineProviderId, input: string, signal?: AbortSignal, items?: string): Promise<unknown> {
    if (!this.available()) throw new MediaSourceError('Аудіоджерело не встановлено. Перезапустіть бота через pnpm dev.');
    // Only canonical provider URLs or our own search prefixes reach the executable; no shell or user flags.
    const args = ['--ignore-config', '--no-playlist', '--no-warnings', '--no-cache-dir', '--no-plugin-dirs',
      '--js-runtimes', `node:${process.execPath}`, '--socket-timeout', '8', '--retries', '0', '--extractor-retries', '0',
      '--use-extractors', provider === 'youtube' ? 'youtube,youtube:search' : 'soundcloud,soundcloud:search',
      '--skip-download', '--print', '%(.{id,title,uploader,artist,duration,thumbnail,webpage_url,url,protocol,is_live,availability,age_limit,http_headers})j',
      '-f', 'bestaudio[protocol=https]/bestaudio[protocol=http]',
      ...(items ? ['--playlist-items', items] : []), '--', input];
    if (this.active >= 4) throw new MediaSourceError('Аудіоджерела зайняті. Спробуйте за кілька секунд.');
    this.active++;
    return new Promise<unknown>((resolve, reject) => {
      execFile(this.executable, args, { windowsHide: true, timeout: 20000, maxBuffer: 2000000, signal,
        // Avoid forwarding bot credentials, sessions or database keys to provider runtimes.
        env: Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE|LANG|LC_ALL)$/i.test(name))),
      }, (error, stdout, stderr) => {
        if (error) { reject(signal?.aborted ? new MediaSourceError('Завантаження аудіо скасовано.') : extractionError(provider, stderr)); return; }
        try {
          // Full search JSON includes every format and thumbnail and can exceed the process budget.
          // Ask for only the required fields, one JSON object per selected track.
          const entries: unknown[] = stdout.trim() ? stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line)) : [];
          if (!items && entries.length !== 1) throw new Error('Expected one track');
          resolve(items ? { entries } : entries[0]);
        } catch { reject(new MediaSourceError('Джерело повернуло некоректну інформацію про трек.')); }
      });
    }).finally(() => { this.active--; });
  }
  async inspect(provider: OnlineProviderId, reference: string, signal?: AbortSignal) {
    return detailsSchema.parse(await this.execute(provider, canonical(provider, reference), signal));
  }
  async search(provider: OnlineProviderId, query: string, page = 0) {
    z.number().int().min(0).max(9).parse(page);
    const end = (page + 1) * 3;
    const prefix = `${provider === 'youtube' ? 'ytsearch' : 'scsearch'}${end}:`;
    const value = z.object({ entries: z.array(detailsSchema.nullable()) }).parse(await this.execute(provider, `${prefix}${query}`, undefined, `${page * 3 + 1}:${end}`));
    return value.entries.filter((entry): entry is AudioDetails => entry !== null);
  }
}
export class OnlineAudioProvider implements MediaSourceProvider {
  readonly searchPageSize = 3;
  private readonly recent = new Map<string, { until: number; value: AudioDetails }>();
  constructor(readonly id: OnlineProviderId, private readonly extractor?: OnlineAudioExtractor) {}
  health(): MediaProviderHealth {
    return { id: this.id, name: names[this.id], state: this.extractor?.available() ? 'available' : 'unconfigured',
      capabilities: { search: true, metadata: true, playback: true, live: false, seek: false, playlists: false } };
  }
  private ready() {
    if (!this.extractor?.available()) throw new MediaSourceError(`${names[this.id]}: аудіоджерело не встановлено. Перезапустіть бота через pnpm dev.`);
    return this.extractor;
  }
  async search(query: string, page = 0): Promise<MediaTrack[]> {
    if (/^https?:\/\//i.test(query)) return page === 0 ? [await this.resolve(query)] : [];
    return (await this.ready().search(this.id, query, page)).map((value) => { const track = publicTrack(this.id, value); this.remember(track.externalUrl, value); return track; });
  }
  private remember(key: string, value: AudioDetails) {
    if (!publicTrack(this.id, value).playable) return;
    if (this.recent.size >= 128) this.recent.delete(this.recent.keys().next().value!);
    this.recent.set(key, { until: Date.now() + 30000, value });
  }
  private async inspect(reference: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const key = canonical(this.id, reference); const cached = this.recent.get(key);
    if (cached && cached.until > Date.now()) return cached.value;
    this.recent.delete(key);
    const value = await this.ready().inspect(this.id, key, signal); this.remember(key, value); return value;
  }
  async resolve(reference: string, signal?: AbortSignal) { return publicTrack(this.id, await this.inspect(reference, signal)); }
  async getPlayableResource(reference: string, signal: AbortSignal): Promise<IncomingMessage> {
    // Reuse a just-resolved source for 30 seconds; long-queued tracks get a fresh URL.
    // Signed URLs stay worker-local and every opening still passes the safe HTTP transport.
    const value = await this.inspect(reference, signal);
    if (!publicTrack(this.id, value).playable || !value.url) throw new MediaSourceError('Для цього треку немає доступного аудіопотоку.');
    const url = validateMediaUrl(value.url);
    const hosts = this.id === 'youtube' ? ['googlevideo.com'] : ['sndcdn.com', 'soundcloud.com'];
    if (!hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new MediaSourceError('Джерело повернуло недозволену адресу аудіо.');
    const headers = Object.fromEntries(Object.entries(value.http_headers ?? {}).filter(([name, value]) =>
      ['user-agent', 'referer', 'origin', 'accept-language'].includes(name.toLowerCase()) && value.length <= 2048 && !/[\r\n]/.test(value)));
    try { return await openAudioStream(url.href, signal, 0, undefined, headers); }
    catch (error) { this.recent.delete(canonical(this.id, reference)); throw error; }
  }
}
