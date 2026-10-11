import { z } from 'zod';
import { log, type MediaPlaylist, type MediaTrack } from '@scrt/shared';
import { mediaPlaylistPageSchema, mediaPlaylistReferenceSchema, mediaPlaylistSchema, mediaTrackSchema, type MediaPlaylistPage } from '@scrt/validation';
import { readMediaDocument, validateMediaUrl } from './audio-http';

const trackSchema = z.object({
  id: z.number().int().positive(), title: z.string().optional(), permalink_url: z.string().optional(),
  duration: z.number().nonnegative().optional(), artwork_url: z.string().nullable().optional(),
  user: z.object({ username: z.string(), avatar_url: z.string().nullable().optional() }).optional(),
  streamable: z.boolean().optional(), sharing: z.string().optional(), policy: z.string().optional(), state: z.string().optional(),
});
type CatalogTrack = z.infer<typeof trackSchema>;
const setSchema = z.object({
  kind: z.literal('playlist'), title: z.string(), permalink_url: z.string(),
  artwork_url: z.string().nullable().optional(), user: z.object({ username: z.string() }),
  sharing: z.literal('public'), public: z.literal(true), track_count: z.number().int().min(0).max(500),
  tracks: z.array(trackSchema).max(500),
}).refine((value) => value.tracks.length === value.track_count, 'Incomplete playlist');
type Catalog = { playlist: MediaPlaylist; tracks: CatalogTrack[]; clientId?: string };
type ReadDocument = typeof readMediaDocument;
const pageSize = 50;

function artwork(value?: string | null): string | null {
  if (!value) return null;
  try { return validateMediaUrl(value).href; } catch { return null; }
}
function publicTrack(value: CatalogTrack): MediaTrack | null {
  if (!value.title || !value.permalink_url || !value.user) return null;
  try {
    const url = validateMediaUrl(value.permalink_url);
    if (url.hostname !== 'soundcloud.com' || !/^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return null;
    const reference = `https://soundcloud.com${url.pathname.replace(/\/$/, '')}`;
    const playable = value.streamable !== false && (!value.sharing || value.sharing === 'public') && (!value.policy || value.policy === 'ALLOW') && (!value.state || value.state === 'finished');
    return mediaTrackSchema.parse({ provider: 'soundcloud', providerItemId: reference, externalUrl: reference,
      type: 'track', title: value.title.slice(0, 300), artist: value.user.username.slice(0, 200),
      durationMs: value.duration ? Math.round(value.duration) : null, artworkUrl: artwork(value.artwork_url || value.user.avatar_url),
      playable, seekable: playable && Boolean(value.duration), explicit: null });
  } catch { return null; }
}

// Read the public set page once, then hydrate only the requested 50-track page.
// The anonymous client identifier comes from that page; no login, cookies or audio URLs are retained.
export class SoundCloudPlaylists {
  private readonly catalog = new Map<string, { until: number; value: Catalog }>();
  private readonly pages = new Map<string, { until: number; value: MediaPlaylistPage }>();
  private readonly pending = new Map<string, Promise<MediaPlaylistPage>>();
  constructor(private readonly read: ReadDocument = readMediaDocument) {}
  private async load(reference: string, signal: AbortSignal): Promise<Catalog> {
    const cached = this.catalog.get(reference);
    if (cached && cached.until > Date.now()) return cached.value;
    const html = await this.read(reference, { hosts: ['soundcloud.com'], contentTypes: ['text/html'], maxBytes: 8000000 }, signal);
    const hydration = html.match(/window\.__sc_hydration\s*=\s*(\[.*?\])\s*;\s*<\/script>/s)?.[1];
    if (!hydration) throw new Error('SoundCloud не надав дані плейлиста. Спробуйте пізніше.');
    const rows = z.array(z.object({ hydratable: z.string(), data: z.unknown() })).max(50).parse(JSON.parse(hydration));
    const data = setSchema.parse(rows.find((row) => row.hydratable === 'playlist')?.data);
    const canonical = mediaPlaylistReferenceSchema.parse(data.permalink_url);
    if (canonical !== reference) throw new Error('SoundCloud повернув інший плейлист.');
    const client = z.object({ id: z.string().regex(/^[a-zA-Z0-9]{32}$/) }).safeParse(rows.find((row) => row.hydratable === 'apiClient')?.data);
    const value: Catalog = { playlist: mediaPlaylistSchema.parse({ provider: 'soundcloud', providerItemId: canonical, externalUrl: canonical,
      title: data.title.slice(0, 300), artist: data.user.username.slice(0, 200), artworkUrl: artwork(data.artwork_url), trackCount: data.track_count }),
      tracks: data.tracks, ...(client.success ? { clientId: client.data.id } : {}) };
    if (this.catalog.size >= 32) this.catalog.delete(this.catalog.keys().next().value!);
    this.catalog.set(reference, { until: Date.now() + 120000, value });
    return value;
  }
  async page(input: string, page = 0): Promise<MediaPlaylistPage> {
    const reference = mediaPlaylistReferenceSchema.parse(input); z.number().int().min(0).max(9).parse(page);
    const key = JSON.stringify([reference, page]); const cached = this.pages.get(key);
    if (cached && cached.until > Date.now()) return structuredClone(cached.value);
    const pending = this.pending.get(key); if (pending) return structuredClone(await pending);
    if (this.pending.size >= 2) throw new Error('Перегляд плейлистів зайнятий. Спробуйте за кілька секунд.');
    const request = this.readPage(reference, page); this.pending.set(key, request);
    try {
      const value = await request;
      if (this.pages.size >= 64) this.pages.delete(this.pages.keys().next().value!);
      // A later page must not outlive the underlying set's order and identity.
      const until = this.catalog.get(reference)?.until;
      if (until && until > Date.now()) this.pages.set(key, { until, value });
      return structuredClone(value);
    } finally { this.pending.delete(key); }
  }
  private async readPage(reference: string, page: number): Promise<MediaPlaylistPage> {
    const startedAt = Date.now();
    try {
      const signal = AbortSignal.timeout(20000); const catalog = await this.load(reference, signal);
      const selected = catalog.tracks.slice(page * pageSize, (page + 1) * pageSize);
      const missing = selected.filter((track) => !track.title || !track.permalink_url || !track.user);
      let hydrated: CatalogTrack[] = [];
      if (missing.length) {
        if (!catalog.clientId) throw new Error('SoundCloud не надав доступ до списку треків. Спробуйте пізніше.');
        const url = new URL('https://api-v2.soundcloud.com/tracks');
        url.searchParams.set('ids', missing.map((track) => track.id).join(',')); url.searchParams.set('client_id', catalog.clientId);
        hydrated = z.array(trackSchema).max(pageSize).parse(JSON.parse(await this.read(url.href,
          { hosts: ['api-v2.soundcloud.com'], contentTypes: ['application/json'], maxBytes: 4000000 }, signal)));
      }
      const byId = new Map(hydrated.map((track) => [track.id, track]));
      const entries = selected.flatMap((track, index) => {
        const parsed = publicTrack(byId.get(track.id) ?? track);
        return parsed ? [{ position: page * pageSize + index + 1, track: parsed }] : [];
      });
      const value = mediaPlaylistPageSchema.parse({ playlist: catalog.playlist, page, entries,
        unavailableCount: selected.length - entries.length, nextPage: (page + 1) * pageSize < catalog.tracks.length ? page + 1 : null });
      log('info', 'media', 'playlist.loaded', { provider: 'soundcloud', page, total: catalog.playlist.trackCount, entries: entries.length,
        unavailable: value.unavailableCount, durationMs: Date.now() - startedAt });
      return value;
    } catch (error) {
      log('warn', 'media', 'playlist.load_failed', { provider: 'soundcloud', page, durationMs: Date.now() - startedAt }, error);
      throw error;
    }
  }
}
