import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaTrack } from '@scrt/shared';
import { DirectAudioProvider, MediaSourceRegistry, type MediaSourceProvider } from './providers';
import { MediaSourceError } from './online-audio';

function song(id: number, title = 'Numb', artist = 'Linkin Park'): MediaTrack {
  const reference = `https://soundcloud.com/artist/track-${id}`;
  return { provider: 'soundcloud', providerItemId: reference, title, artist, type: 'track', durationMs: 180000, artworkUrl: null, externalUrl: reference, playable: true, seekable: true, explicit: null };
}
function catalog() {
  return { id: 'soundcloud', searchPageSize: 20,
    health: () => ({ id: 'soundcloud', name: 'SoundCloud', state: 'available', capabilities: { search: true, metadata: true, playback: true, live: false, seek: true, playlists: false } }),
    search: vi.fn<(query: string, page?: number) => Promise<MediaTrack[]>>(),
    resolve: vi.fn<(reference: string) => Promise<MediaTrack>>(), getPlayableResource: vi.fn(),
  } satisfies MediaSourceProvider;
}
afterEach(() => vi.useRealTimers());
describe('fast tolerant catalog search', () => {
  it('routes set links into playlist discovery without track extraction or catalog text search', async () => {
    const reference = 'https://soundcloud.com/artist/sets/list'; const base = catalog();
    const playlist = { provider: 'soundcloud' as const, providerItemId: reference, externalUrl: reference, title: 'List', artist: 'Artist', artworkUrl: null, trackCount: 1 };
    const source: MediaSourceProvider = { ...base, health: () => ({ ...base.health(), capabilities: { ...base.health().capabilities, playlists: true } }),
      playlist: vi.fn(async () => ({ playlist, page: 0, entries: [{ position: 1, track: song(1) }], unavailableCount: 0, nextPage: null })) };
    const registry = new MediaSourceRegistry([source], false);
    const found = await registry.search(`${reference}?si=share`);
    expect(found).toMatchObject({ results: [], playlists: [playlist], nextPage: null, unavailable: [] });
    expect(base.search).not.toHaveBeenCalled(); expect(base.resolve).not.toHaveBeenCalled();
    expect(registry.searchedTrack('soundcloud', song(1).providerItemId)?.title).toBe('Numb');
  });
  it('returns twenty songs, coalesces equivalent queries and caches pages independently', async () => {
    const source = catalog(); source.search.mockResolvedValue(Array.from({ length: 20 }, (_, index) => song(index)));
    const registry = new MediaSourceRegistry([source]);
    const [first, concurrent] = await Promise.all([registry.search('Linkin   Park Numb'), registry.search('linkin park numb')]);
    expect(first.results).toHaveLength(20); expect(concurrent).toEqual(first); expect(first.nextPage).toBe(1);
    expect(source.search).toHaveBeenCalledOnce(); expect(source.resolve).not.toHaveBeenCalled();
    await registry.search('Linkin Park Numb', 1); expect(source.search).toHaveBeenCalledTimes(2);
  });
  it('expands weak matches once and keeps the expanded query for pagination', async () => {
    const source = catalog();
    source.search.mockImplementation(async (query, page = 0) => query === 'Linkin Park' ? Array.from({ length: 20 }, (_, index) => song(page * 20 + index)) : [song(50, 'Faint')]);
    const registry = new MediaSourceRegistry([source]);
    const first = await registry.search('Linkin Park Numm');
    expect(first.results).toHaveLength(20); expect(first.matchedQuery).toBe('Linkin Park'); expect(first.nextPage).toBe(1);
    await registry.search('Linkin Park Numm', 1);
    expect(source.search).toHaveBeenLastCalledWith('Linkin Park', 1); expect(source.search).toHaveBeenCalledTimes(3);
  });
  it('corrects a new single-word transposition without needing previous searches', async () => {
    const source = catalog(); source.search.mockImplementation(async (query) => query === 'Numb' ? [song(1)] : []);
    const result = await new MediaSourceRegistry([source]).search('Nubm');
    expect(result.results[0]?.title).toBe('Numb'); expect(result.matchedQuery).toBe('Numb');
  });
  it('corrects misspellings using public metadata from previous searches', async () => {
    const source = catalog(); source.search.mockImplementation(async (query) => query === 'Linkin Park Numb' ? [song(1)] : []);
    const registry = new MediaSourceRegistry([source]); await registry.search('Linkin Park Numb');
    const result = await registry.search('Linkn Park Nubm');
    expect(result.matchedQuery).toBe('Linkin Park Numb'); expect(result.results[0]?.title).toBe('Numb');
    expect(source.search).toHaveBeenCalledTimes(2);
  });
  it('fixes the keyboard layout before contacting the provider', async () => {
    const source = catalog(); source.search.mockResolvedValue([song(1)]);
    const result = await new MediaSourceRegistry([source]).search('дштлшт зфкл тгьи');
    expect(source.search.mock.calls[0]).toEqual(['linkin park numb', 0]); expect(result.matchedQuery).toBe('linkin park numb');
  });
  it('preserves original matches when optional expansion fails', async () => {
    const source = catalog(); source.search.mockResolvedValueOnce([song(1, 'Faint')]).mockRejectedValueOnce(new MediaSourceError('Temporary failure'));
    const result = await new MediaSourceRegistry([source]).search('Linkin Park Numm');
    expect(result.results).toEqual([song(1, 'Faint')]); expect(result.unavailable).toEqual([]);
  });
  it('includes previously discovered close titles without replacing native exact matches', async () => {
    const source = catalog(); source.search.mockResolvedValueOnce([song(1)]).mockResolvedValueOnce([song(2, 'Nubm', 'Another artist')]);
    const registry = new MediaSourceRegistry([source]); await registry.search('Numb');
    const result = await registry.search('Nubm');
    expect(result.results.map((track) => track.title)).toEqual(['Nubm', 'Numb']); expect(source.search).toHaveBeenCalledTimes(2);
  });
  it('keeps previously searched direct URLs out of text catalog results', async () => {
    const direct = new DirectAudioProvider(); const reference = 'https://audio.example/numb.mp3';
    vi.spyOn(direct, 'search').mockImplementation(async (query) => query === reference ? [{ ...song(2), provider: 'direct', providerItemId: reference, externalUrl: reference }] : []);
    const source = catalog(); source.search.mockResolvedValue([song(1)]);
    const registry = new MediaSourceRegistry([direct, source]); await registry.search(reference);
    expect((await registry.search('Numb')).results.map((track) => track.provider)).toEqual(['soundcloud']);
  });
  it('reports a failed expansion when the original query returned no results', async () => {
    const source = catalog(); source.search.mockResolvedValueOnce([]).mockRejectedValueOnce(new MediaSourceError('Temporary failure'));
    const result = await new MediaSourceRegistry([source]).search('Nubm');
    expect(result.unavailable).toEqual(['SoundCloud']); expect(result.errors).toEqual(['Temporary failure']);
  });
  it('skips expansion when a fuzzy match already exists and deduplicates results', async () => {
    const source = catalog(); source.search.mockResolvedValue([song(1), song(1), song(2, 'Faint')]);
    const result = await new MediaSourceRegistry([source]).search('Linkin Park Numm');
    expect(result.results).toEqual([song(1), song(2, 'Faint')]); expect(source.search).toHaveBeenCalledOnce();
  });
  it('recomputes expired plans and never applies query rewriting to URLs', async () => {
    vi.useFakeTimers(); const source = catalog(); source.search.mockResolvedValue([song(1)]);
    const registry = new MediaSourceRegistry([source]); await registry.search('Linkin Park Numb');
    await registry.search(song(1).externalUrl); expect(source.search).toHaveBeenLastCalledWith(song(1).externalUrl, 0);
    vi.advanceTimersByTime(120001); await registry.search('Linkin Park Numb'); expect(source.search).toHaveBeenCalledTimes(3);
    for (const query of ['x', 'x'.repeat(251)]) await expect(registry.search(query)).rejects.toThrow();
  });
});
