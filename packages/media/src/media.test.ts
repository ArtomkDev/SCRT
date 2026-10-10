import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaQueueItem, MediaTrack } from '@scrt/shared';
import { isPublicMediaAddress, mediaDestination, openAudioStream, validateMediaUrl } from './audio-http';
import { countedVotes, scheduledQueue, voteThreshold } from './queue';
import { createMediaSources, DirectAudioProvider, MediaSourceRegistry, YouTubeProvider, type MediaSourceProvider } from './providers';
afterEach(() => vi.unstubAllGlobals());
describe('SSRF prevention', () => {
  it.each(['127.0.0.1', '127.3.2.1', '0.0.0.0', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1', '2002:0a00::1'])('blocks %s', (address) => expect(isPublicMediaAddress(address)).toBe(false));
  it.each(['file:///tmp/audio', 'ftp://example.com/audio', 'data:audio/mpeg;base64,QQ==', 'https://user:pass@example.com/a', 'http://localhost/a', 'http://127.0.0.1/a', 'http://[::1]/a', 'https://example.com:3100/a'])('rejects unsafe URL %s', (url) => expect(() => validateMediaUrl(url)).toThrow());
  it('permits public addresses and pins only public DNS answers', async () => {
    expect(isPublicMediaAddress('8.8.8.8')).toBe(true); expect(isPublicMediaAddress('2606:4700:4700::1111')).toBe(true);
    await expect(mediaDestination('https://audio.example/a', async () => [{ address: '8.8.8.8', family: 4 }])).resolves.toMatchObject({ address: '8.8.8.8' });
    await expect(mediaDestination('https://audio.example/a', async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }])).rejects.toThrow();
  });
  it('revalidates private redirect targets and bounds redirects before fetching', async () => {
    await expect(openAudioStream('https://127.0.0.1/audio', undefined, 1)).rejects.toThrow();
    await expect(openAudioStream('https://example.com/audio', undefined, 4)).rejects.toThrow('переадресацій');
  });
  it('prefers public IPv4 over IPv6 DNS order while preserving IPv6-only support and rejecting mixed private answers', async () => {
    const ipv6 = { address: '2606:4700:4700::1111', family: 6 }, ipv4 = { address: '8.8.8.8', family: 4 };
    await expect(mediaDestination('https://audio.example/a', async () => [ipv6, ipv4])).resolves.toMatchObject(ipv4);
    await expect(mediaDestination('https://audio.example/a', async () => [ipv6])).resolves.toMatchObject(ipv6);
    await expect(mediaDestination('https://audio.example/a', async () => [ipv6, ipv4, { address: '10.0.0.1', family: 4 }])).rejects.toThrow('DNS');
  });
});
const item = (id: string, user: string) => ({ queueItemId: id, requestedByUserId: user }) as MediaQueueItem;
describe('queue scheduler and votes', () => {
  const queue = [item('A1', 'A'), item('A2', 'A'), item('A3', 'A'), item('A4', 'A'), item('B1', 'B'), item('C1', 'C'), item('C2', 'C')];
  it('keeps FIFO and deterministically interleaves requesters without mutating metadata', () => {
    expect(scheduledQueue(queue, 'normal')).toEqual(queue); expect(scheduledQueue(queue, 'fair').map((x) => x.queueItemId)).toEqual(['A1', 'B1', 'C1', 'A2', 'C2', 'A3', 'A4']); expect(queue[1]?.queueItemId).toBe('A2');
    expect(scheduledQueue(queue, 'fair', 'A')[0]?.queueItemId).toBe('B1');
  });
  it('counts only current listeners, deduplicates, and requires at least one vote', () => {
    expect(voteThreshold(['A', 'B', 'C'], 0.5)).toBe(2); expect(voteThreshold([], 0.5)).toBe(1);
    expect(countedVotes(new Set(['A', 'left']), ['A', 'A', 'B'])).toBe(1);
  });
});
function catalog(count = 1): MediaSourceProvider {
  const tracks: MediaTrack[] = Array.from({ length: count }, (_, index) => ({ provider: 'youtube', providerItemId: `track${index}`, title: `Music ${index}`, artist: 'Artist', type: 'track', durationMs: 60000, artworkUrl: null, externalUrl: `https://youtube.com/watch?v=track${index}`, playable: true, seekable: true, explicit: null }));
  return { id: 'youtube', health: () => ({ ...new YouTubeProvider('test-key').health(), capabilities: { ...new YouTubeProvider('test-key').health().capabilities, playback: true } }), searchPageSize: 15,
    search: async (_query, page = 0) => tracks.slice(page * 15, (page + 1) * 15), resolve: async () => tracks[0]!, getPlayableResource: async () => { throw new Error('Not used'); } };
}
describe('source capabilities and outages', () => {
  it('retains bounded public search metadata for continuation without accepting unknown references or expired entries', async () => {
    vi.useFakeTimers();
    try {
      const registry = new MediaSourceRegistry([catalog()]); await registry.search('Music');
      const track = registry.searchedTrack('youtube', 'track0'); expect(track?.title).toBe('Music 0');
      expect(registry.searchedTrack('direct', 'track0')).toBeNull(); expect(registry.searchedTrack('youtube', 'forged')).toBeNull();
      vi.advanceTimersByTime(120001); expect(registry.searchedTrack('youtube', 'track0')).not.toBeNull();
      vi.advanceTimersByTime(86400000); expect(registry.searchedTrack('youtube', 'track0')).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it('paginates catalogs, isolates page caches and ends when no further results exist', async () => {
    const youtube = catalog(17);
    const search = vi.spyOn(youtube, 'search'); const registry = new MediaSourceRegistry([youtube]);
    const first = await registry.search('Music'); const second = await registry.search('Music', 1);
    expect(first.results).toHaveLength(15); expect(first.nextPage).toBe(1);
    expect(second.results.map((track) => track.title)).toEqual(['Music 15', 'Music 16']); expect(second.nextPage).toBeNull();
    await registry.search('music', 1); expect(search).toHaveBeenCalledTimes(2);
    await expect(registry.search('Music', 10)).rejects.toThrow(); expect(search).toHaveBeenCalledTimes(2);
  });
  it('registers only the supported providers and never claims playback in the YouTube metadata fallback', async () => {
    expect(createMediaSources({}).health().map((provider) => provider.id)).toEqual(['direct', 'youtube', 'soundcloud']);
    const youtube = new YouTubeProvider(); expect(youtube.health().capabilities.playback).toBe(false);
    await expect(youtube.getPlayableResource()).rejects.toThrow('лише');
  });
  it.each([
    ['https://music.youtube.com/watch?v=hmzIgMhbefo&si=share', 'YouTube', new YouTubeProvider()],
  ])('reports an unconfigured catalog instead of silently returning no matches for %s', async (url, name, provider) => {
    const direct = new DirectAudioProvider(); const search = vi.spyOn(direct, 'search');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const result = await new MediaSourceRegistry([direct, provider]).search(` ${url} `);
    expect(result).toEqual({ results: [], unavailable: [name], nextPage: null });
    expect(search).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('resolves a YouTube Music URL through the metadata API without claiming playback support', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ items: [{ id: 'hmzIgMhbefo', snippet: { title: 'Track', channelTitle: 'Artist', thumbnails: {} }, contentDetails: { duration: 'PT3M' } }] }));
    vi.stubGlobal('fetch', fetch);
    const youtube = new YouTubeProvider('test-key');
    const result = await new MediaSourceRegistry([youtube]).search('https://music.youtube.com/watch?v=hmzIgMhbefo&si=share');
    expect(result.results).toEqual([expect.objectContaining({ provider: 'youtube', providerItemId: 'hmzIgMhbefo', title: 'Track', playable: false, durationMs: 180000 })]);
    expect(result.unavailable).toEqual([]); expect(fetch).toHaveBeenCalledOnce();
    const url = new URL(fetch.mock.calls[0]![0] as string);
    expect(url.hostname).toBe('www.googleapis.com'); expect(url.pathname).toBe('/youtube/v3/videos'); expect(url.searchParams.get('id')).toBe('hmzIgMhbefo');
    expect(url.searchParams.has('si')).toBe(false);
  });
  it('rejects private direct references and removed catalog URLs before opening a stream', async () => {
    await expect(new DirectAudioProvider().resolve('https://audio.example/file.mp3?token=secret')).rejects.toThrow();
    await expect(new DirectAudioProvider().resolve('https://open.spotify.com/track/0123456789012345678901')).rejects.toThrow('Каталог');
  });
  it('keeps playable results during catalog outages and caches repeated searches', async () => {
    const youtube = new YouTubeProvider('test-key'); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 429, headers: { 'retry-after': '60' } })));
    const direct = new DirectAudioProvider(); vi.spyOn(direct, 'resolve').mockResolvedValue({ provider: 'direct', providerItemId: 'https://audio.example/file.mp3', title: 'file', artist: 'Audio', durationMs: null, type: 'track', artworkUrl: null, externalUrl: 'https://audio.example/file.mp3', playable: true, seekable: false, explicit: null });
    vi.spyOn(direct, 'search').mockImplementation(() => direct.resolve('https://audio.example/file.mp3').then((track) => [track]));
    const registry = new MediaSourceRegistry([direct, youtube]);
    const first = await registry.search('Track'); expect(first.results[0]?.playable).toBe(true); expect(first.unavailable).toContain('YouTube');
    await registry.search('Track'); expect(fetch).toHaveBeenCalledTimes(1); expect(registry.health().find((p) => p.id === 'youtube')?.state).toBe('degraded');
  });
  it('keeps case-sensitive URL paths distinct in the search cache', async () => {
    const direct = new DirectAudioProvider();
    const resolve = vi.spyOn(direct, 'resolve').mockImplementation(async (url) => ({ provider: 'direct', providerItemId: url, title: url, artist: 'Audio', durationMs: null, type: 'track', artworkUrl: null, externalUrl: url, playable: true, seekable: false, explicit: null }));
    const registry = new MediaSourceRegistry([direct]);
    const upper = await registry.search('https://audio.example/Track.mp3');
    const lower = await registry.search('https://audio.example/track.mp3');
    expect(upper.results[0]?.providerItemId).not.toBe(lower.results[0]?.providerItemId);
    await registry.search('https://audio.example/Track.mp3'); expect(resolve).toHaveBeenCalledTimes(2);
  });
});
