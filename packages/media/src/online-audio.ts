import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import type { MediaProviderHealth, MediaTrack } from '@scrt/shared';
import { mediaTrackSchema } from '@scrt/validation';
import { MediaAudioHttpError, openAudioStream, validateMediaUrl } from './audio-http';
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
    externalUrl, playable: !restricted && Boolean(value.url), seekable: !restricted && Boolean(value.url) && !value.is_live && Boolean(value.duration && value.duration > 0), explicit: null,
  });
}
export function extractorExecutable(cwd = process.cwd()): string {
  const filename = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const local = join(cwd, '.media-tools', filename);
  return existsSync(local) ? local : join(cwd, 'apps', 'bot', '.media-tools', filename);
}
class ExtractionFailure extends MediaSourceError {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}
function extractionError(provider: OnlineProviderId, stderr: string): ExtractionFailure {
  if (/confirm you[^\r\n]{0,30}not a bot/i.test(stderr)) return new ExtractionFailure(`${names[provider]} тимчасово відхилив запит із мережі бота. Спробуйте ще раз трохи пізніше.`, true);
  // YouTube prefixes both throttling and deleted videos with "Video unavailable".
  // Classify the reason before that generic prefix or extractor advice/URLs.
  if (/this content isn['’]t available,? try again later|rate[- ]limited|too many requests|HTTP Error 429/i.test(stderr)) return new ExtractionFailure(`${names[provider]} тимчасово обмежив запити з мережі бота. Спробуйте ще раз пізніше.`, false);
  if (/timed?\s*out|connection (?:reset|closed|aborted)|remote end closed|HTTP Error 5\d\d|temporarily unavailable|temporary failure|name or service not known|unable to resolve|failed to resolve/i.test(stderr)) return new ExtractionFailure(`${names[provider]} тимчасово не відповідає. Спробуйте ще раз пізніше.`, true);
  if (/requested format is not available/i.test(stderr)) return new ExtractionFailure('Для цього треку немає підтримуваного публічного аудіоформату.', false);
  if (/sign in|login required|authentication required/i.test(stderr)) return new ExtractionFailure(`${names[provider]} вимагає авторизації для цього треку. Підтримуються лише публічні аудіопотоки.`, false);
  if (/private (?:video|track)|(?:video|track)(?: has been| was| is)? (?:deleted|removed|private)|removed by|not available in your (?:country|region)|not made this video available in your country|geo[- ]restricted|HTTP Error 404|(?:video|track) not found|members[- ]only|premium[- ]only/i.test(stderr)) return new ExtractionFailure('Трек недоступний: видалений, приватний або має обмеження доступу.', false);
  if (/HTTP Error (?:401|403)|access denied|forbidden/i.test(stderr)) return new ExtractionFailure(`${names[provider]} відхилив доступ до аудіо з мережі бота. Спробуйте ще раз пізніше або інше джерело.`, false);
  if (/unavailable|not available|try again later/i.test(stderr)) return new ExtractionFailure(`${names[provider]} тимчасово не надав аудіо цього треку. Спробуйте ще раз пізніше.`, true);
  return new ExtractionFailure('Не вдалося отримати аудіо з цього джерела. Спробуйте пізніше або інший трек.', false);
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
    const deadline = Date.now() + 20000;
    try {
      for (let attempt = 0; ; attempt++) {
        try { return await this.run(provider, args, Math.max(1, deadline - Date.now()), signal, items); }
        catch (error) {
          // Repeat the same public request once. No credentials, client changes or unbounded retries.
          if (!(error instanceof ExtractionFailure) || !error.retryable || attempt > 0 || signal?.aborted || deadline - Date.now() < 1500) throw error;
          try { await delay(500, undefined, { signal }); }
          catch { throw new MediaSourceError('Завантаження аудіо скасовано.'); }
        }
      }
    } finally { this.active--; }
  }
  private run(provider: OnlineProviderId, args: string[], timeout: number, signal?: AbortSignal, items?: string): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      execFile(this.executable, args, { windowsHide: true, timeout, maxBuffer: 2000000, signal,
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
    });
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
  private readonly pendingInspections = new Map<string, Promise<AudioDetails>>();
  constructor(readonly id: OnlineProviderId, private readonly extractor?: OnlineAudioExtractor) {}
  health(): MediaProviderHealth {
    return { id: this.id, name: names[this.id], state: this.extractor?.available() ? 'available' : 'unconfigured',
      capabilities: { search: true, metadata: true, playback: true, live: false, seek: true, playlists: false } };
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
    const now = Date.now(); let until = now + 300000;
    if (value.url) {
      const expiry = new URL(value.url).searchParams.get('expire');
      if (expiry && /^\d+$/.test(expiry)) until = Math.min(until, Number(expiry) * 1000 - 60000);
    }
    if (until <= now) return;
    if (this.recent.size >= 128) this.recent.delete(this.recent.keys().next().value!);
    this.recent.set(key, { until, value });
  }
  private async inspect(reference: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const key = canonical(this.id, reference); const cached = this.recent.get(key);
    if (cached && cached.until > Date.now()) return cached.value;
    this.recent.delete(key);
    // Concurrent catalog requests for alternate share URLs must not multiply upstream extraction.
    // Playback has its own cancellation signal and never shares a caller-owned process.
    if (!signal) {
      const pending = this.pendingInspections.get(key); if (pending) return pending;
      const task = this.extract(key).finally(() => { this.pendingInspections.delete(key); });
      this.pendingInspections.set(key, task); return task;
    }
    return this.extract(key, signal);
  }
  private async extract(key: string, signal?: AbortSignal) {
    const value = await this.ready().inspect(this.id, key, signal); this.remember(key, value); return value;
  }
  async resolve(reference: string, signal?: AbortSignal) { return publicTrack(this.id, await this.inspect(reference, signal)); }
  async getPlayableResource(reference: string, signal: AbortSignal): Promise<IncomingMessage> {
    // Keep valid signed URLs worker-local for at most five minutes. A rejected cached
    // signature gets one fresh extraction; every opening still uses the safe transport.
    const key = canonical(this.id, reference);
    const cached = (this.recent.get(key)?.until ?? 0) > Date.now();
    const value = await this.inspect(reference, signal);
    try { return await this.open(value, signal); }
    catch (error) {
      this.recent.delete(key);
      if (!cached || !(error instanceof MediaAudioHttpError) || ![401, 403, 410].includes(error.status)) throw error;
      signal.throwIfAborted();
      const fresh = await this.extract(key, signal);
      try { return await this.open(fresh, signal); }
      catch (error) { this.recent.delete(key); throw error; }
    }
  }
  private async open(value: AudioDetails, signal: AbortSignal): Promise<IncomingMessage> {
    if (!publicTrack(this.id, value).playable || !value.url) throw new MediaSourceError('Для цього треку немає доступного аудіопотоку.');
    const url = validateMediaUrl(value.url);
    const hosts = this.id === 'youtube' ? ['googlevideo.com'] : ['sndcdn.com', 'soundcloud.com'];
    if (!hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new MediaSourceError('Джерело повернуло недозволену адресу аудіо.');
    const headers = Object.fromEntries(Object.entries(value.http_headers ?? {}).filter(([name, value]) =>
      ['user-agent', 'referer', 'origin', 'accept-language'].includes(name.toLowerCase()) && value.length <= 2048 && !/[\r\n]/.test(value)));
    for (let attempt = 0; ; attempt++) {
      try { return await openAudioStream(url.href, signal, 0, undefined, headers); }
      catch (error) {
        const temporary = error instanceof MediaAudioHttpError && [408, 500, 502, 503, 504].includes(error.status)
          || error instanceof Error && 'code' in error && ['EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT'].includes(String(error.code));
        if (temporary && attempt === 0 && !signal.aborted) {
          try { await delay(500, undefined, { signal }); }
          catch { throw new MediaSourceError('Завантаження аудіо скасовано.'); }
          continue;
        }
        if (temporary) throw new MediaSourceError(`${names[this.id]} тимчасово не відповідає. Спробуйте ще раз пізніше.`);
        if (error instanceof MediaAudioHttpError && error.status === 429) throw new MediaSourceError(`${names[this.id]} тимчасово обмежив запити з мережі бота. Спробуйте ще раз пізніше.`);
        throw error;
      }
    }
  }
}
