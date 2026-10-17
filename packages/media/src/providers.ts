import { z } from 'zod';
import { log, type MediaProviderHealth, type MediaProviderId, type MediaTrack } from '@scrt/shared';
import { mediaTrackSchema, mediaPlaylistPageSchema, soundcloudPlaylistUrl, type MediaPlaylistPage } from '@scrt/validation';
import { openAudioStream, validateMediaUrl, type MediaAudioStream } from './audio-http';
import { MediaSourceError, OnlineAudioProvider, type OnlineAudioExtractor } from './online-audio';
import { fallbackSearchQuery, normalizeSearchQuery, preferredSearchQuery, searchRelevance } from './search-query';

interface MediaSearchResult { results: MediaTrack[]; playlists?: MediaPlaylistPage['playlist'][]; unavailable: string[]; errors?: string[]; nextPage: number | null; matchedQuery?: string }

export interface MediaSourceProvider {
  id: MediaProviderId; health(): MediaProviderHealth;
  searchPageSize?: number;
  searchPageLimit?: number;
  playlist?(reference: string, page?: number): Promise<MediaPlaylistPage>;
  search(query: string, page?: number): Promise<MediaTrack[]>;
  resolve(reference: string, signal?: AbortSignal): Promise<MediaTrack>;
  getPlayableResource(reference: string, signal: AbortSignal): Promise<MediaAudioStream>;
}
const capabilities = (playback: boolean, live = false) => ({ search: true, metadata: true, playback, live, seek: false, playlists: false });
export class DirectAudioProvider implements MediaSourceProvider {
  readonly id = 'direct' as const;
  health(): MediaProviderHealth { return { id: this.id, name: 'HTTP аудіо', state: 'available', capabilities: capabilities(true, true) }; }
  async search(query: string) { return /^https?:\/\//i.test(query) ? [await this.resolve(query)] : []; }
  async resolve(reference: string, signal?: AbortSignal): Promise<MediaTrack> {
    const url = validateMediaUrl(reference);
    // Query-bearing URLs may contain expiring secrets: never persist these as a track reference.
    if (url.search) throw new Error('Потрібне пряме посилання на аудіофайл без приватних або тимчасових параметрів.');
    if (['spotify.com', 'youtube.com', 'youtu.be', 'soundcloud.com'].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error('Каталог не є прямим аудіоджерелом.');
    const stream = await openAudioStream(url.href, signal); const live = Boolean(stream.headers['icy-name'] || stream.headers['icy-metaint']); stream.destroy();
    return { provider: this.id, providerItemId: url.href, title: decodeURIComponent(url.pathname.split('/').at(-1) || url.hostname).slice(0, 300), artist: url.hostname, type: live ? 'live' : 'track', durationMs: null, artworkUrl: null, externalUrl: url.href, playable: true, seekable: false, explicit: null };
  }
  async getPlayableResource(reference: string, signal: AbortSignal) { const url = validateMediaUrl(reference); if (url.search) throw new Error('Private direct URL'); return openAudioStream(reference, signal); }
}
class ProviderHttpError extends Error { constructor(readonly retryMs: number) { super('Джерело тимчасово недоступне.'); } }
async function providerJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8000), redirect: 'error' });
  if (!response.ok) { await response.body?.cancel(); throw new ProviderHttpError(response.status === 429 ? Math.min(600000, Math.max(30000, Number(response.headers.get('retry-after') || 60) * 1000)) : 30000); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('Empty provider response');
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2000000) throw new Error('Provider response too large'); chunks.push(value); } }
  finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const youtubeVideo = z.object({ id: z.string(), snippet: z.object({ title: z.string(), channelTitle: z.string(), liveBroadcastContent: z.string().optional(), thumbnails: z.record(z.string(), z.object({ url: z.url() })) }), contentDetails: z.object({ duration: z.string() }) });
function youtubeDuration(value: string): number | null { const m = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/); return m ? ((Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) * 1000 || null) : null; }
export class YouTubeProvider implements MediaSourceProvider {
  readonly id = 'youtube' as const;
  readonly searchPageSize = 10;
  readonly searchPageLimit = 5;
  constructor(private readonly key?: string) {}
  health(): MediaProviderHealth { return { id: this.id, name: 'YouTube', state: this.key ? 'available' : 'unconfigured', capabilities: capabilities(false) }; }
  private async videos(ids: string[]) {
    if (!this.key) throw new Error('YouTube не налаштовано.');
    const result = z.object({ items: z.array(youtubeVideo) }).parse(await providerJson(`https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: 'snippet,contentDetails', id: ids.join(','), key: this.key })}`));
    return result.items.map((item): MediaTrack => mediaTrackSchema.parse({ provider: this.id, providerItemId: item.id, title: item.snippet.title, artist: item.snippet.channelTitle, type: item.snippet.liveBroadcastContent === 'live' ? 'live' : 'track', durationMs: youtubeDuration(item.contentDetails.duration), artworkUrl: item.snippet.thumbnails.medium?.url ?? item.snippet.thumbnails.default?.url ?? null, externalUrl: `https://www.youtube.com/watch?v=${item.id}`, playable: false, seekable: false, explicit: null }));
  }
  async search(query: string, page = 0) {
    if (!this.key) throw new Error('YouTube не налаштовано.');
    if (/^https?:\/\//i.test(query)) { if (page > 0) return []; const url = new URL(query); const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(url.hostname) ? url.searchParams.get('v') : null; return id ? [await this.resolve(id)] : []; }
    if (page >= this.searchPageLimit) return [];
    const result = z.object({ items: z.array(z.object({ id: z.object({ videoId: z.string() }) })) }).parse(await providerJson(`https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({ part: 'snippet', type: 'video', q: query, maxResults: String((page + 1) * 10), key: this.key })}`));
    const ids = result.items.slice(page * 10, (page + 1) * 10).map((item) => item.id.videoId);
    return ids.length ? this.videos(ids) : [];
  }
  async resolve(reference: string) { if (!/^[\w-]{11}$/.test(reference)) throw new Error('Invalid YouTube ID'); const track = (await this.videos([reference]))[0]; if (!track) throw new Error('Відео не знайдено.'); return track; }
  async getPlayableResource(): Promise<MediaAudioStream> { throw new Error('YouTube підтримує лише пошук та інформацію.'); }
}
export class MediaSourceRegistry {
  private readonly cache = new Map<string, { until: number; value: MediaSearchResult }>();
  private readonly inflight = new Map<string, Promise<MediaSearchResult>>();
  private readonly searchPlans = new Map<string, { query: string; until: number }>();
  private readonly failures = new Map<MediaProviderId, number>();
  // Public metadata only. Audio URLs still expire in the provider's separate stream cache.
  private readonly searchedTracks = new Map<string, { track: MediaTrack; until: number }>();
  constructor(private readonly providers: MediaSourceProvider[], private readonly youtubeSearchEnabled = true) {}
  health(): MediaProviderHealth[] {
    return this.providers.map((provider) => {
      const health = provider.health();
      return { ...health, capabilities: { ...health.capabilities, search: health.capabilities.search && (provider.id !== 'youtube' || this.youtubeSearchEnabled) }, ...((this.failures.get(provider.id) ?? 0) > Date.now() ? { state: 'degraded' as const } : {}) };
    });
  }
  get(id: MediaProviderId) { const provider = this.providers.find((p) => p.id === id); if (!provider) throw new Error('Джерело не підтримується.'); return provider; }
  searchedTrack(provider: MediaProviderId, reference: string): MediaTrack | null {
    const entry = this.searchedTracks.get(JSON.stringify([provider, reference]));
    return entry && entry.until > Date.now() ? { ...entry.track } : null;
  }
  async playlist(reference: string, page = 0): Promise<MediaPlaylistPage> {
    const provider = this.get('soundcloud');
    if (!provider.playlist || !provider.health().capabilities.playlists) throw new MediaSourceError('Перегляд плейлистів SoundCloud недоступний.');
    const value = mediaPlaylistPageSchema.parse(await provider.playlist(reference, page));
    if (value.playlist.providerItemId !== soundcloudPlaylistUrl(reference) || value.page !== page) throw new MediaSourceError('Джерело повернуло інший плейлист або сторінку.');
    this.rememberSearch({ results: value.entries.map((entry) => entry.track), unavailable: [], nextPage: null });
    return value;
  }
  private rememberSearch(value: MediaSearchResult) {
    for (const track of value.results) {
      const key = JSON.stringify([track.provider, track.providerItemId]); this.searchedTracks.delete(key);
      if (this.searchedTracks.size >= 512) this.searchedTracks.delete(this.searchedTracks.keys().next().value!);
      this.searchedTracks.set(key, { track, until: Date.now() + 86400000 });
    }
    return value;
  }
  async search(query: string, page = 0) {
    z.number().int().min(0).max(9).parse(page);
    const normalized = /^https?:\/\//i.test(query.trim()) ? query.trim() : normalizeSearchQuery(query);
    z.string().min(2).max(250).parse(normalized);
    const key = JSON.stringify([/^https?:\/\//i.test(normalized) ? normalized : normalized.toLowerCase(), page]);
    const cached = this.cache.get(key); if (cached && cached.until > Date.now()) return this.rememberSearch(cached.value);
    const pending = this.inflight.get(key); if (pending) return pending;
    const task = this.runSearch(normalized, page); this.inflight.set(key, task);
    try { const value = await task; if (this.cache.size >= 128) this.cache.delete(this.cache.keys().next().value!); this.cache.set(key, { until: Date.now() + (value.unavailable.length ? 5000 : 120000), value }); return this.rememberSearch(value); }
    finally { this.inflight.delete(key); }
  }
  private async searchCatalogPage(provider: MediaSourceProvider, query: string, page: number): Promise<MediaTrack[]> {
    const cached = this.cache.get(JSON.stringify([normalizeSearchQuery(query).toLowerCase(), page]));
    if (cached && cached.until > Date.now() && !cached.value.unavailable.includes(provider.health().name) && !cached.value.matchedQuery) {
      const tracks = cached.value.results.filter((track) => track.provider === provider.id);
      if (tracks.length) return tracks;
    }
    return (await provider.search(query, page)).map((track) => mediaTrackSchema.parse(track));
  }
  private async catalogSearch(provider: MediaSourceProvider, query: string, page: number) {
    const key = JSON.stringify([provider.id, query.toLowerCase()]);
    const plan = this.searchPlans.get(key);
    let effectiveQuery = plan && plan.until > Date.now() ? plan.query : preferredSearchQuery(query);
    let tracks = await this.searchCatalogPage(provider, effectiveQuery, page);
    const matchingQuery = preferredSearchQuery(query);
    const relevance = (items: MediaTrack[]) => Math.max(0, ...items.map((track) => searchRelevance(matchingQuery, track)));
    // One bounded fallback on the first page. Later pages keep the same upstream query.
    if (page === 0 && (!plan || plan.until <= Date.now()) && relevance(tracks) < 0.82) {
      const known = [...this.searchedTracks.values()].filter((entry) => entry.until > Date.now() && entry.track.provider === provider.id).map((entry) => entry.track);
      const alternative = effectiveQuery !== query ? query : fallbackSearchQuery(query, tracks, known);
      if (alternative && alternative.length <= 250 && alternative.toLowerCase() !== effectiveQuery.toLowerCase()) {
        const startedAt = Date.now();
        try {
          const expanded = await this.searchCatalogPage(provider, alternative, 0);
          const improved = relevance(expanded) > relevance(tracks) || (!tracks.length && expanded.length > 0);
          log('info', 'media', 'source.search.expanded', { provider: provider.id, durationMs: Date.now() - startedAt, originalResults: tracks.length, expandedResults: expanded.length, improved });
          if (improved) { tracks = expanded; effectiveQuery = alternative; }
        } catch (error) {
          // An optional correction cannot discard successful original results or mark the source offline.
          log('warn', 'media', 'source.search.expansion.failed', { provider: provider.id, durationMs: Date.now() - startedAt }, error);
          if (!tracks.length) throw error;
        }
      }
    }
    if (page === 0) {
      this.searchPlans.delete(key);
      if (this.searchPlans.size >= 128) this.searchPlans.delete(this.searchPlans.keys().next().value!);
      this.searchPlans.set(key, { query: effectiveQuery, until: Date.now() + 120000 });
    }
    return { tracks, query: effectiveQuery };
  }
  private async runSearch(query: string, page: number): Promise<MediaSearchResult> {
    let target: MediaProviderId | null = null;
    if (/^https?:\/\//i.test(query)) { const host = new URL(query).hostname; if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) target = 'youtube'; else if (host === 'soundcloud.com' || host.endsWith('.soundcloud.com')) target = 'soundcloud'; else target = 'direct'; }
    if (target === 'youtube' && !this.youtubeSearchEnabled) return { results: [], unavailable: [], errors: ['Пошук YouTube тимчасово вимкнено на хостингу. Використайте SoundCloud або пряме аудіопосилання.'], nextPage: null };
    const targetProvider = this.providers.find((provider) => provider.id === target);
    if (targetProvider?.health().state === 'unconfigured') {
      log('warn', 'media', 'source.search.unconfigured', { provider: targetProvider.id, inputType: 'url' });
      return { results: [], unavailable: [targetProvider.health().name], nextPage: null };
    }
    if (target && page > 0) return { results: [], unavailable: [], nextPage: null };
    if (target === 'soundcloud' && soundcloudPlaylistUrl(query)) {
      try { const value = await this.playlist(query); return { results: [], playlists: [value.playlist], unavailable: [], nextPage: null }; }
      catch (error) { return { results: [], unavailable: ['SoundCloud'], errors: [error instanceof MediaSourceError ? error.message : 'Не вдалося відкрити плейлист SoundCloud.'], nextPage: null }; }
    }
    const providers = this.providers.filter((p) => p.health().state !== 'unconfigured' && (p.id !== 'youtube' || this.youtubeSearchEnabled) && (!target || p.id === target));
    const matchedQueries = new Set<string>();
    const values = await Promise.allSettled(providers.map(async (provider) => {
      if ((this.failures.get(provider.id) ?? 0) > Date.now()) throw new Error('Source cooling down');
      const startedAt = Date.now(); const diagnostic = { provider: provider.id, page, inputType: target ? 'url' : 'text' };
      log('info', 'media', 'source.search.started', diagnostic);
      try {
        const result = !target && provider.searchPageSize ? await this.catalogSearch(provider, query, page)
          : { tracks: (page > 0 ? [] : await provider.search(query, page)).map((track) => mediaTrackSchema.parse(track)), query };
        const tracks = result.tracks;
        if (tracks.length && result.query.toLowerCase() !== query.toLowerCase()) matchedQueries.add(result.query);
        this.failures.delete(provider.id);
        log('info', 'media', 'source.search.completed', { ...diagnostic, durationMs: Date.now() - startedAt, results: tracks.length });
        return tracks;
      }
      catch (error) {
        log('error', 'media', 'source.search.failed', { ...diagnostic, durationMs: Date.now() - startedAt }, error);
        if ((provider.id === 'youtube' || provider.id === 'soundcloud') && !(error instanceof MediaSourceError)) this.failures.set(provider.id, Date.now() + (error instanceof ProviderHttpError ? error.retryMs : 30000));
        throw error;
      }
    }));
    const unique = new Map(values.flatMap((v) => v.status === 'fulfilled' ? v.value : []).map((track) => [JSON.stringify([track.provider, track.providerItemId]), track]));
    const matchingQuery = target ? query : preferredSearchQuery(query);
    if (!target && page === 0 && unique.size < 40) {
      const available = new Set(providers.filter((provider, index) => provider.searchPageSize && values[index]?.status === 'fulfilled').map((provider) => provider.id));
      const similar = [...this.searchedTracks.values()].filter((entry) => entry.until > Date.now() && available.has(entry.track.provider) && !unique.has(JSON.stringify([entry.track.provider, entry.track.providerItemId])) && searchRelevance(matchingQuery, entry.track) >= 0.82)
        .map((entry) => entry.track).sort((a, b) => searchRelevance(matchingQuery, b) - searchRelevance(matchingQuery, a)).slice(0, Math.min(12, 40 - unique.size));
      for (const track of similar) unique.set(JSON.stringify([track.provider, track.providerItemId]), track);
    }
    const results = [...unique.values()].sort((a, b) => Number(b.playable) - Number(a.playable) || (target ? 0 : searchRelevance(matchingQuery, b) - searchRelevance(matchingQuery, a)));
    const errors = values.flatMap((value) => value.status === 'rejected' && value.reason instanceof MediaSourceError ? [value.reason.message] : []);
    const more = !target && page < 9 && values.some((value, index) => value.status === 'fulfilled' && Boolean(providers[index]?.searchPageSize) && value.value.length >= providers[index]!.searchPageSize! && page + 1 < (providers[index]!.searchPageLimit ?? 10));
    return { results: results.slice(0, 40), nextPage: more ? page + 1 : null, unavailable: providers.filter((_, i) => values[i]?.status === 'rejected').map((p) => p.health().name), ...(errors.length ? { errors } : {}), ...(matchedQueries.size === 1 ? { matchedQuery: [...matchedQueries][0]! } : {}) };
  }
}
export function createMediaSources(env: { NODE_ENV?: string; YOUTUBE_API_KEY?: string; MEDIA_YOUTUBE_IP_FAMILY?: 'ipv4' | 'ipv6'; MEDIA_YOUTUBE_PROXY_URL?: string }, extractor?: OnlineAudioExtractor) {
  return new MediaSourceRegistry([new DirectAudioProvider(), extractor?.available() ? new OnlineAudioProvider('youtube', extractor, env.MEDIA_YOUTUBE_IP_FAMILY, env.MEDIA_YOUTUBE_PROXY_URL) : new YouTubeProvider(env.YOUTUBE_API_KEY), new OnlineAudioProvider('soundcloud', extractor)], env.NODE_ENV !== 'production');
}
