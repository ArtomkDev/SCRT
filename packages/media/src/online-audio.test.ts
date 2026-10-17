import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ open: vi.fn(), hls: vi.fn(), exec: vi.fn(), probe: vi.fn(), exists: vi.fn(() => true) }));
vi.mock('node:child_process', () => ({ execFile: mocks.exec, spawnSync: mocks.probe }));
vi.mock('node:fs', () => ({ existsSync: mocks.exists }));
vi.mock('./audio-http', async (original) => ({ ...await original<typeof import('./audio-http')>(), openAudioStream: mocks.open }));
vi.mock('./soundcloud-hls', async (original) => ({ ...await original<typeof import('./soundcloud-hls')>(), openSoundCloudHls: mocks.hls }));
import { createMediaSources, DirectAudioProvider, MediaSourceRegistry } from './providers';
import { MediaSourceError, OnlineAudioProvider, YtDlpExtractor, soundcloudReference, youtubeReference, type OnlineAudioExtractor } from './online-audio';
import { MediaAudioProxyError } from './audio-proxy';
import { MediaAudioHttpError } from './audio-http';
import { runtimeLogSnapshot } from '@scrt/shared';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllEnvs(); mocks.exists.mockReturnValue(true); });
function details(provider: 'youtube' | 'soundcloud' = 'youtube'): Awaited<ReturnType<OnlineAudioExtractor['inspect']>> {
  return { id: provider === 'youtube' ? 'TwumA6YhQp4' : '2363190935', title: 'Track', uploader: 'Artist', duration: 180,
    webpage_url: provider === 'youtube' ? 'https://www.youtube.com/watch?v=TwumA6YhQp4' : 'https://soundcloud.com/artist/track',
    url: provider === 'youtube' ? 'https://rr1.googlevideo.com/videoplayback?expire=secret' : 'https://cf-media.sndcdn.com/track.mp3?Policy=secret',
    http_headers: { 'User-Agent': 'Provider-Agent', Authorization: 'secret', Cookie: 'secret', Origin: 'https://www.youtube.com', Referer: 'invalid\r\nheader' }, protocol: 'https', availability: 'public' };
}
function extractor() {
  return { available: () => true, inspect: vi.fn(async () => details()), search: vi.fn(async () => [details()]) } satisfies OnlineAudioExtractor;
}
describe('online audio providers', () => {
  it('opens HLS-only SoundCloud tracks on its current CDN without treating the manifest as direct audio', async () => {
    const adapter = extractor(); const signal = new AbortController().signal; const stream = new PassThrough();
    const value = { ...details('soundcloud'), protocol: 'm3u8_native', url: 'https://playback.media-streaming.soundcloud.cloud/track/playlist.m3u8?token=secret' };
    adapter.inspect.mockResolvedValue(value); mocks.hls.mockResolvedValue(stream);
    const provider = new OnlineAudioProvider('soundcloud', adapter);
    expect((await provider.resolve(value.webpage_url)).seekable).toBe(true);
    expect(await provider.getPlayableResource(value.webpage_url, signal)).toBe(stream);
    expect(mocks.hls).toHaveBeenCalledWith(value.url, signal, expect.any(Object));
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it('returns twenty flat entries with artwork, without caching catalog URLs as audio', async () => {
    const entry = { ...details('soundcloud'), url: 'https://api.soundcloud.com/tracks/2363190935', protocol: undefined,
      thumbnail: undefined, thumbnails: [{ url: 'https://i1.sndcdn.com/artwork.jpg' }], artists: ['Actual Artist'], uploader: 'Uploader' };
    const entries = Array.from({ length: 20 }, (_, index) => ({ ...entry, id: String(index), webpage_url: `https://soundcloud.com/artist/track-${index}` }));
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(null, entries.map((value) => JSON.stringify(value)).join('\n'), ''));
    const adapter = new YtDlpExtractor('/installed/yt-dlp');
    const inspect = vi.spyOn(adapter, 'inspect').mockResolvedValue(details('soundcloud'));
    const provider = new OnlineAudioProvider('soundcloud', adapter);
    const results = await provider.search('Actual Artist');
    expect(results).toHaveLength(20); expect(results[0]).toMatchObject({ playable: true, artist: 'Actual Artist', artworkUrl: 'https://i1.sndcdn.com/artwork.jpg' });
    expect(inspect).not.toHaveBeenCalled(); expect(JSON.stringify(results)).not.toContain('api.soundcloud.com');
    await provider.resolve(results[0]!.providerItemId); expect(inspect).toHaveBeenCalledOnce();
    const args = mocks.exec.mock.calls[0]![1]; expect(args[args.indexOf('--cache-dir') + 1]).toContain('soundcloud-cache');
  });
  it('skips malformed flat entries and retains restricted metadata without enabling playback', async () => {
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(null, [null, { id: 'broken' }, { ...details(), availability: 'private' }].map((value) => JSON.stringify(value)).join('\n'), ''));
    const provider = new OnlineAudioProvider('youtube', new YtDlpExtractor('/installed/yt-dlp'));
    expect(await provider.search('Artist Track')).toEqual([expect.objectContaining({ playable: false, seekable: false })]);
  });
  it('reports invalid search output instead of falsely claiming no songs exist', async () => {
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(null, JSON.stringify({ id: 'broken' }), ''));
    await expect(new YtDlpExtractor('/installed/yt-dlp').search('soundcloud', 'Artist')).rejects.toThrow('некоректні результати');
    const adapter = extractor(); adapter.search.mockResolvedValue([{ ...details('soundcloud'), webpage_url: 'http://127.0.0.1/private' }]);
    await expect(new OnlineAudioProvider('soundcloud', adapter).search('Artist')).rejects.toThrow('некоректні результати');
    adapter.search.mockResolvedValue([{ ...details('soundcloud'), webpage_url: 'http://127.0.0.1/private' }, details('soundcloud')]);
    expect(await new OnlineAudioProvider('soundcloud', adapter).search('Artist')).toHaveLength(1);
  });
  it('reserves extractor slots for playback while two searches are running', async () => {
    const callbacks: Array<(error: null, stdout: string, stderr: string) => void> = [];
    mocks.exec.mockImplementation((_file, _args, _options, callback) => { callbacks.push(callback); });
    const adapter = new YtDlpExtractor('/installed/yt-dlp');
    const first = adapter.search('soundcloud', 'First'), second = adapter.search('soundcloud', 'Second');
    await expect(adapter.search('soundcloud', 'Third')).rejects.toThrow('Пошук зайнятий');
    const playback = adapter.inspect('youtube', 'TwumA6YhQp4'); expect(mocks.exec).toHaveBeenCalledTimes(3);
    callbacks[0]!(null, JSON.stringify(details('soundcloud')), ''); callbacks[1]!(null, JSON.stringify(details('soundcloud')), ''); callbacks[2]!(null, JSON.stringify(details()), '');
    await Promise.all([first, second, playback]);
  });
  it('searches only SoundCloud in production and rejects YouTube links before extraction', async () => {
    const adapter = extractor(); adapter.search.mockResolvedValue([details('soundcloud')]);
    const registry = createMediaSources({ NODE_ENV: 'production' }, adapter);
    expect((await registry.search('Artist Track')).results.map((track) => track.provider)).toEqual(['soundcloud']);
    expect(adapter.search).toHaveBeenCalledTimes(1);
    expect(adapter.search).toHaveBeenCalledWith('soundcloud', 'Artist Track', 0);
    const youtube = await registry.search(details().webpage_url);
    expect(youtube.results).toEqual([]); expect(youtube.errors?.[0]).toContain('вимкнено');
    expect(adapter.inspect).not.toHaveBeenCalled();
    expect(registry.health().find((provider) => provider.id === 'youtube')?.capabilities.search).toBe(false);
    adapter.inspect.mockResolvedValue(details('soundcloud'));
    expect((await registry.search(details('soundcloud').webpage_url)).results[0]?.provider).toBe('soundcloud');
    const stream = new PassThrough() as unknown as IncomingMessage; stream.headers = {}; mocks.open.mockResolvedValue(stream);
    expect((await registry.search('https://audio.example/track.mp3')).results[0]?.provider).toBe('direct');
    expect(createMediaSources({ NODE_ENV: 'development' }, adapter).health().find((provider) => provider.id === 'youtube')?.capabilities.search).toBe(true);
  });
  it.each(['youtube', 'soundcloud'] as const)('advertises seeking only for finite public %s audio', async (id) => {
    const adapter = extractor(); const provider = new OnlineAudioProvider(id, adapter);
    adapter.inspect.mockResolvedValue(details(id));
    expect(await provider.resolve(details(id).webpage_url)).toMatchObject({ seekable: true, durationMs: 180000 });
    for (const override of [{ is_live: true }, { duration: undefined }, { duration: 0 }, { availability: 'private' }, { url: undefined }]) {
      // Use a fresh provider to avoid its short-lived metadata cache.
      adapter.inspect.mockResolvedValue({ ...details(id), ...override });
      expect((await new OnlineAudioProvider(id, adapter).resolve(details(id).webpage_url)).seekable).toBe(false);
    }
  });
  it.each([
    'https://music.youtube.com/watch?v=TwumA6YhQp4&si=share',
    'https://youtu.be/TwumA6YhQp4?si=share',
    'https://www.youtube.com/watch?v=TwumA6YhQp4&list=RDtest&start_radio=1',
    'https://www.youtube.com/shorts/TwumA6YhQp4',
  ])('normalizes YouTube links without persisting share or playlist parameters: %s', (value) => expect(youtubeReference(value)).toBe('TwumA6YhQp4'));
  it.each(['https://youtube.com.evil.test/watch?v=TwumA6YhQp4', 'https://user:pass@youtube.com/watch?v=TwumA6YhQp4', 'https://youtube.com/playlist?list=x', '--exec command', 'http://127.0.0.1/video'])('rejects unsafe or non-track references: %s', (value) => expect(() => youtubeReference(value)).toThrow());
  it('normalizes public SoundCloud tracks and rejects other domains, profiles and playlists', () => {
    expect(soundcloudReference('https://www.soundcloud.com/artist/track/?si=share')).toBe('https://soundcloud.com/artist/track');
    for (const value of ['https://soundcloud.com/artist', 'https://soundcloud.com/artist/sets/album', 'https://soundcloud.com.evil.test/artist/track', 'https://soundcloud.com/search/tracks']) expect(() => soundcloudReference(value)).toThrow();
  });
  it.each(['youtube', 'soundcloud'] as const)('routes %s URLs to a playable source with no API key or direct audio fallback', async (id) => {
    const adapter = extractor(); adapter.inspect.mockResolvedValue(details(id));
    const registry = createMediaSources({}, adapter); const direct = vi.spyOn(registry.get('direct'), 'search');
    const value = await registry.search(details(id).webpage_url);
    expect(value.results[0]).toMatchObject({ provider: id, playable: true, title: 'Track', durationMs: 180000 });
    expect(value.unavailable).toEqual([]); expect(direct).not.toHaveBeenCalled();
    expect(JSON.stringify(value)).not.toContain('secret'); expect(JSON.stringify(value)).not.toContain('http_headers');
  });
  it('reuses a just-resolved source and sends only permitted headers to the safe HTTP transport', async () => {
    const adapter = extractor(); const provider = new OnlineAudioProvider('youtube', adapter);
    const signal = new AbortController().signal; const stream = new PassThrough() as unknown as IncomingMessage;
    mocks.open.mockResolvedValue(stream);
    await provider.resolve('TwumA6YhQp4');
    expect(await provider.getPlayableResource('TwumA6YhQp4', signal)).toBe(stream);
    expect(adapter.inspect).toHaveBeenCalledTimes(1);
    expect(mocks.open).toHaveBeenCalledWith(details().url, signal, 0, undefined, { 'User-Agent': 'Provider-Agent', Origin: 'https://www.youtube.com' });
  });
  it('uses configured IPv6 for YouTube audio while retaining the normal SoundCloud transport', async () => {
    const adapter = extractor(); const registry = createMediaSources({ MEDIA_YOUTUBE_IP_FAMILY: 'ipv6' }, adapter);
    const signal = new AbortController().signal; mocks.open.mockImplementation(async () => new PassThrough());
    await registry.get('youtube').getPlayableResource('TwumA6YhQp4', signal);
    expect(mocks.open).toHaveBeenLastCalledWith(details().url, signal, 0, undefined, expect.any(Object), 6);
    adapter.inspect.mockResolvedValue(details('soundcloud'));
    await registry.get('soundcloud').getPlayableResource(details('soundcloud').webpage_url, signal);
    expect(mocks.open).toHaveBeenLastCalledWith(details('soundcloud').url, signal, 0, undefined, expect.any(Object));
  });
  it('uses the same configured proxy for YouTube audio while SoundCloud stays direct', async () => {
    const adapter = extractor(); const proxy = 'http://proxy-user:proxy-secret@proxy.example:8080';
    const registry = createMediaSources({ MEDIA_YOUTUBE_IP_FAMILY: 'ipv6', MEDIA_YOUTUBE_PROXY_URL: proxy }, adapter);
    const signal = new AbortController().signal; mocks.open.mockImplementation(async () => new PassThrough());
    await registry.get('youtube').getPlayableResource('TwumA6YhQp4', signal);
    expect(mocks.open).toHaveBeenLastCalledWith(details().url, signal, 0, undefined, expect.any(Object), 4, proxy);
    adapter.inspect.mockResolvedValue(details('soundcloud'));
    await registry.get('soundcloud').getPlayableResource(details('soundcloud').webpage_url, signal);
    expect(mocks.open).toHaveBeenLastCalledWith(details('soundcloud').url, signal, 0, undefined, expect.any(Object));
  });
  it.each(['PROXY_AUTH_REQUIRED', 'PROXY_UNAVAILABLE'] as const)('preserves a typed provider failure when the audio tunnel reports %s', async (code) => {
    const adapter = extractor(); mocks.open.mockRejectedValue(new MediaAudioProxyError(code));
    const provider = new OnlineAudioProvider('youtube', adapter, 'ipv4', 'http://proxy.example:8080');
    await expect(provider.getPlayableResource('TwumA6YhQp4', new AbortController().signal)).rejects.toMatchObject({ code: code === 'PROXY_AUTH_REQUIRED' ? code : 'NETWORK_UNREACHABLE' });
    expect(mocks.open).toHaveBeenCalledOnce();
  });
  it('pauses new extraction for a blocked provider for one minute without extending the deadline on clicks', async () => {
    vi.useFakeTimers(); const adapter = extractor(); const provider = new OnlineAudioProvider('youtube', adapter);
    adapter.inspect.mockRejectedValueOnce(new MediaSourceError('YouTube network blocked', 'NETWORK_BLOCKED'));
    await expect(provider.resolve('TwumA6YhQp4')).rejects.toMatchObject({ code: 'NETWORK_BLOCKED' });
    expect(provider.health().state).toBe('degraded');
    await vi.advanceTimersByTimeAsync(30000);
    await expect(provider.resolve('JB4RmAsA8K4')).rejects.toMatchObject({ code: 'NETWORK_BLOCKED' });
    await expect(provider.search('Another track')).rejects.toMatchObject({ code: 'NETWORK_BLOCKED' });
    expect(adapter.inspect).toHaveBeenCalledOnce(); expect(adapter.search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30000);
    expect((await provider.resolve('TwumA6YhQp4')).playable).toBe(true);
    expect(adapter.inspect).toHaveBeenCalledTimes(2); expect(provider.health().state).toBe('available');
  });
  it('retains usable cached audio and other providers when new YouTube extraction is blocked', async () => {
    const adapter = extractor(); const registry = createMediaSources({}, adapter); const youtube = registry.get('youtube');
    await youtube.resolve('TwumA6YhQp4');
    adapter.inspect.mockRejectedValueOnce(new MediaSourceError('network blocked', 'NETWORK_BLOCKED'));
    await expect(youtube.resolve('JB4RmAsA8K4')).rejects.toMatchObject({ code: 'NETWORK_BLOCKED' });
    mocks.open.mockResolvedValue(new PassThrough());
    await youtube.getPlayableResource('TwumA6YhQp4', new AbortController().signal);
    expect(adapter.inspect).toHaveBeenCalledTimes(2); expect(mocks.open).toHaveBeenCalledOnce();
    expect(registry.health().find((provider) => provider.id === 'youtube')?.state).toBe('degraded');
    expect(registry.health().find((provider) => provider.id === 'soundcloud')?.state).toBe('available');
    adapter.inspect.mockResolvedValue(details('soundcloud'));
    expect((await registry.get('soundcloud').resolve(details('soundcloud').webpage_url)).playable).toBe(true);
  });
  it('re-extracts an expired source instead of keeping a stale signed URL for queued tracks', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      const adapter = extractor(); const provider = new OnlineAudioProvider('youtube', adapter);
      await provider.search('Track'); await provider.resolve('TwumA6YhQp4'); expect(adapter.inspect).not.toHaveBeenCalled();
      now.mockReturnValue(302000); mocks.open.mockResolvedValue(new PassThrough());
      await provider.getPlayableResource('TwumA6YhQp4', new AbortController().signal);
      expect(adapter.inspect).toHaveBeenCalledOnce();
    } finally { now.mockRestore(); }
  });
  it('keeps a still-valid signed URL across repeated switches after thirty seconds', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100000);
    const adapter = extractor(); const provider = new OnlineAudioProvider('youtube', adapter);
    mocks.open.mockImplementation(async () => new PassThrough());
    await provider.resolve('TwumA6YhQp4'); now.mockReturnValue(220000);
    await provider.getPlayableResource('TwumA6YhQp4', new AbortController().signal);
    await provider.resolve('TwumA6YhQp4');
    expect(adapter.inspect).toHaveBeenCalledOnce();
  });
  it('expires signed URLs a minute before their actual expiry', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100000);
    const adapter = extractor(); adapter.inspect.mockResolvedValue({ ...details(), url: 'https://rr1.googlevideo.com/videoplayback?expire=200' });
    const provider = new OnlineAudioProvider('youtube', adapter);
    await provider.resolve('TwumA6YhQp4'); now.mockReturnValue(139000); await provider.resolve('TwumA6YhQp4');
    expect(adapter.inspect).toHaveBeenCalledOnce(); now.mockReturnValue(140000); await provider.resolve('TwumA6YhQp4');
    expect(adapter.inspect).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403, 410])('refreshes a cached rejected signature once (HTTP %s)', async (status) => {
    const adapter = extractor(); const provider = new OnlineAudioProvider('youtube', adapter);
    await provider.resolve('TwumA6YhQp4');
    const fresh = { ...details(), url: 'https://rr2.googlevideo.com/videoplayback?fresh=1' };
    adapter.inspect.mockResolvedValueOnce(fresh);
    const stream = new PassThrough(); mocks.open.mockRejectedValueOnce(new MediaAudioHttpError(status)).mockResolvedValueOnce(stream);
    expect(await provider.getPlayableResource('TwumA6YhQp4', new AbortController().signal)).toBe(stream);
    expect(adapter.inspect).toHaveBeenCalledTimes(2); expect(mocks.open.mock.calls[1]![0]).toBe(fresh.url);
  });
  it('does not loop on persistent stream rejection or refresh unsafe destinations', async () => {
    const adapter = extractor(); const provider = new OnlineAudioProvider('youtube', adapter);
    await provider.resolve('TwumA6YhQp4'); mocks.open.mockRejectedValue(new MediaAudioHttpError(403));
    await expect(provider.getPlayableResource('TwumA6YhQp4', new AbortController().signal)).rejects.toThrow();
    expect(adapter.inspect).toHaveBeenCalledTimes(2); expect(mocks.open).toHaveBeenCalledTimes(2);
    adapter.inspect.mockResolvedValueOnce({ ...details(), url: 'https://evil.test/audio' });
    await expect(provider.getPlayableResource('TwumA6YhQp4', new AbortController().signal)).rejects.toThrow('недозволену');
    expect(adapter.inspect).toHaveBeenCalledTimes(3); expect(mocks.open).toHaveBeenCalledTimes(2);
  });
  it('shares one catalog extraction for concurrent YouTube Music, watch and short share links', async () => {
    const adapter = extractor(); let resolve!: (value: ReturnType<typeof details>) => void;
    adapter.inspect.mockImplementation(() => new Promise((accept) => { resolve = accept; }));
    const provider = new OnlineAudioProvider('youtube', adapter);
    const first = provider.resolve('https://music.youtube.com/watch?v=TwumA6YhQp4&si=first');
    const second = provider.resolve('https://youtu.be/TwumA6YhQp4?si=second');
    expect(adapter.inspect).toHaveBeenCalledOnce(); resolve(details());
    expect(await first).toEqual(await second);
  });
  it('clears failed shared extractions so a later link request can recover', async () => {
    const adapter = extractor(); adapter.inspect.mockRejectedValueOnce(new MediaSourceError('Temporary failure'));
    const provider = new OnlineAudioProvider('youtube', adapter);
    const results = await Promise.allSettled([provider.resolve('TwumA6YhQp4'), provider.resolve('https://youtu.be/TwumA6YhQp4')]);
    expect(results.every((result) => result.status === 'rejected')).toBe(true); expect(adapter.inspect).toHaveBeenCalledOnce();
    expect((await provider.resolve('TwumA6YhQp4')).playable).toBe(true); expect(adapter.inspect).toHaveBeenCalledTimes(2);
  });
  it('keeps playback cancellation separate from a concurrent catalog extraction', async () => {
    const adapter = extractor(); let resolve!: (value: ReturnType<typeof details>) => void;
    adapter.inspect.mockImplementationOnce(() => new Promise((accept) => { resolve = accept; }));
    const provider = new OnlineAudioProvider('youtube', adapter); const catalog = provider.resolve('TwumA6YhQp4');
    const signal = new AbortController().signal; mocks.open.mockResolvedValue(new PassThrough());
    await provider.getPlayableResource('TwumA6YhQp4', signal);
    expect(adapter.inspect).toHaveBeenCalledTimes(2); expect(adapter.inspect).toHaveBeenLastCalledWith('youtube', details().webpage_url, signal);
    resolve(details()); await catalog;
  });
  it.each(['https://127.0.0.1/audio', 'https://evil.test/audio', 'https://googlevideo.com.evil.test/audio'])('rejects unsafe or foreign extractor stream URLs before requesting audio: %s', async (url) => {
    const adapter = extractor(); adapter.inspect.mockResolvedValue({ ...details(), url });
    await expect(new OnlineAudioProvider('youtube', adapter).getPlayableResource('TwumA6YhQp4', new AbortController().signal)).rejects.toThrow();
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it('does not advertise restricted or age-gated tracks as playable', async () => {
    const adapter = extractor(); adapter.inspect.mockResolvedValue({ ...details(), availability: 'private' });
    const provider = new OnlineAudioProvider('youtube', adapter);
    expect((await provider.resolve('TwumA6YhQp4')).playable).toBe(false);
    adapter.inspect.mockResolvedValue({ ...details(), age_limit: 18 });
    expect((await provider.resolve('TwumA6YhQp4')).playable).toBe(false);
  });
  it('returns a clear provider access error instead of reporting HTTP audio failure', async () => {
    const adapter = extractor(); adapter.inspect.mockRejectedValue(new MediaSourceError('YouTube вимагає авторизації.'));
    const direct = new DirectAudioProvider(); const spy = vi.spyOn(direct, 'search');
    const result = await new MediaSourceRegistry([direct, new OnlineAudioProvider('youtube', adapter)]).search('https://youtu.be/TwumA6YhQp4');
    expect(result).toEqual({ results: [], unavailable: ['YouTube'], errors: ['YouTube вимагає авторизації.'], nextPage: null });
    expect(spy).not.toHaveBeenCalled();
  });
});
describe('extractor process boundary', () => {
  it('allows native HLS as a SoundCloud fallback while keeping YouTube on direct audio formats', async () => {
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(null, JSON.stringify(details('soundcloud')), ''));
    const adapter = new YtDlpExtractor('/installed/yt-dlp');
    await adapter.inspect('soundcloud', details('soundcloud').webpage_url);
    await adapter.inspect('youtube', 'TwumA6YhQp4');
    const formats = mocks.exec.mock.calls.map(([, args]) => args[args.indexOf('-f') + 1]);
    expect(formats).toEqual(['bestaudio[protocol=https]/bestaudio[protocol=http]/bestaudio[protocol=m3u8_native]', 'bestaudio[protocol=https]/bestaudio[protocol=http]']);
  });
  it('records installed versus executable health and probes versions without forwarding bot credentials', () => {
    const before = runtimeLogSnapshot(); const after = before.entries.at(-1)?.sequence ?? 0;
    vi.stubEnv('DISCORD_BOT_TOKEN', 'never-forward'); vi.stubEnv('NODE_OPTIONS', '--require unwanted');
    mocks.probe.mockReturnValueOnce({ status: 0, stdout: '2026.09.27.232945\n', signal: null })
      .mockReturnValueOnce({ status: null, stdout: '', signal: null, error: Object.assign(new Error('permission denied'), { code: 'EACCES' }) });
    const adapter = new YtDlpExtractor('/installed/yt-dlp'); adapter.logDiagnostics(); adapter.logDiagnostics();
    const options = mocks.probe.mock.calls[0]![2];
    expect(options.env).not.toHaveProperty('DISCORD_BOT_TOKEN'); expect(options.env).not.toHaveProperty('NODE_OPTIONS');
    const entries = runtimeLogSnapshot({ runId: before.runId, after }).entries.filter((entry) => entry.action === 'extractor.dependencies.checked');
    expect(entries[0]?.context).toMatchObject({ installed: true, executable: true, version: '2026.09.27.232945' });
    expect(entries[1]?.context).toMatchObject({ installed: true, executable: false });
  });
  it.each(['youtube', 'soundcloud'] as const)('searches the next twenty %s entries without extracting audio and bounds the page before spawning', async (provider) => {
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(null, `${JSON.stringify(details(provider))}\n${JSON.stringify(details(provider))}\n`, ''));
    const adapter = new YtDlpExtractor('/installed/yt-dlp'); await adapter.search(provider, 'Artist Track', 1);
    const args = mocks.exec.mock.calls[0]![1];
    expect(args.at(-1)).toBe(`${provider === 'youtube' ? 'ytsearch' : 'scsearch'}40:Artist Track`);
    expect(args[args.indexOf('--playlist-items') + 1]).toBe('21:40');
    expect(args).toContain('--flat-playlist'); expect(args).not.toContain('-f');
    expect(mocks.exec.mock.calls[0]![2].timeout).toBeLessThanOrEqual(8000);
    expect(args).toContain('--print'); expect(args).not.toContain('--dump-single-json');
    for (const page of [-1, 10, 1.5]) await expect(adapter.search(provider, 'Track', page)).rejects.toThrow();
    expect(mocks.exec).toHaveBeenCalledOnce();
  });
  it('passes only canonical URLs as an argument without a shell, forwards cancellation and removes secrets', async () => {
    vi.stubEnv('DISCORD_BOT_TOKEN', 'never-forward'); vi.stubEnv('NODE_OPTIONS', '--require unwanted');
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(null, JSON.stringify(details()), ''));
    const adapter = new YtDlpExtractor('/installed/yt-dlp'); const signal = new AbortController().signal;
    await adapter.inspect('youtube', 'https://music.youtube.com/watch?v=TwumA6YhQp4&si=share', signal);
    const [file, args, options] = mocks.exec.mock.calls[0]!;
    expect(file).toBe('/installed/yt-dlp'); expect(args.at(-1)).toBe('https://www.youtube.com/watch?v=TwumA6YhQp4');
    expect(args.at(-2)).toBe('--'); expect(args).toContain('--ignore-config'); expect(args).toContain('--no-plugin-dirs');
    expect(args).toContain('--force-ipv4'); expect(args).not.toContain('--no-warnings');
    expect(options.shell).toBeUndefined(); expect(options.signal).toBe(signal); expect(options.timeout).toBeGreaterThan(19000); expect(options.timeout).toBeLessThanOrEqual(20000);
    expect(options.env).not.toHaveProperty('DISCORD_BOT_TOKEN'); expect(options.env).not.toHaveProperty('NODE_OPTIONS');
  });
  it('selects IPv6 only for YouTube extraction and logs the actual configured family', async () => {
    const before = runtimeLogSnapshot(); const after = before.entries.at(-1)?.sequence ?? 0;
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(null, JSON.stringify(details()), ''));
    const adapter = new YtDlpExtractor('/installed/yt-dlp', 'ipv6');
    await adapter.inspect('youtube', 'TwumA6YhQp4');
    expect(mocks.exec.mock.calls[0]![1]).toContain('--force-ipv6'); expect(mocks.exec.mock.calls[0]![1]).not.toContain('--force-ipv4');
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(null, JSON.stringify(details('soundcloud')), ''));
    await adapter.inspect('soundcloud', details('soundcloud').webpage_url);
    expect(mocks.exec.mock.calls[1]![1]).toContain('--force-ipv4');
    const entries = runtimeLogSnapshot({ runId: before.runId, after }).entries.filter((entry) => entry.action === 'extractor.started');
    expect(entries.map((entry) => entry.context.family)).toEqual([6, 4]);
  });
  it('routes YouTube searches and inspections through its configured proxy, without forwarding it to SoundCloud or logs', async () => {
    const proxy = 'https://proxy-user:proxy-secret@proxy.example:8443';
    const before = runtimeLogSnapshot(); const after = before.entries.at(-1)?.sequence ?? 0;
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(null, JSON.stringify(details()), `WARNING: ${proxy} proxy-user proxy-secret ${Buffer.from('proxy-user:proxy-secret').toString('base64')}`));
    const adapter = new YtDlpExtractor('/installed/yt-dlp', 'ipv6', proxy);
    await adapter.inspect('youtube', 'TwumA6YhQp4'); await adapter.search('youtube', 'song');
    for (const call of mocks.exec.mock.calls.slice(0, 2)) { expect(call[1][call[1].indexOf('--proxy') + 1]).toBe(proxy); expect(call[1]).toContain('--force-ipv4'); }
    const output = JSON.stringify(runtimeLogSnapshot({ runId: before.runId, after }).entries);
    expect(output).toContain('"route":"proxy"'); expect(output).not.toMatch(/proxy-user|proxy-secret|proxy\.example|cHJveHktdXNlcjpwcm94eS1zZWNyZXQ=/);
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(null, JSON.stringify(details('soundcloud')), ''));
    await adapter.inspect('soundcloud', details('soundcloud').webpage_url);
    const args = mocks.exec.mock.calls[2]![1]; expect(args[args.indexOf('--proxy') + 1]).toBe(''); expect(args).not.toContain(proxy);
  });
  it('classifies proxy authentication separately without retrying or exposing credentials', async () => {
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(new Error('failed'), '', 'ERROR: Unable to download webpage: Tunnel connection failed: 407 Proxy Authentication Required'));
    await expect(new YtDlpExtractor('/installed/yt-dlp', 'ipv4', 'http://proxy.example').inspect('youtube', 'TwumA6YhQp4')).rejects.toMatchObject({ code: 'PROXY_AUTH_REQUIRED' });
    expect(mocks.exec).toHaveBeenCalledOnce();
  });
  it('redacts credentials before truncating stderr so a secret spanning the limit cannot leak', async () => {
    const password = 'SENSITIVE-PROXY-PASSWORD-123456789';
    const before = runtimeLogSnapshot(); const after = before.entries.at(-1)?.sequence ?? 0;
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(null, JSON.stringify(details()), `${'x'.repeat(3990)}${password}`));
    await new YtDlpExtractor('/installed/yt-dlp', 'ipv4', `http://user:${password}@proxy.example`).inspect('youtube', 'TwumA6YhQp4');
    const output = JSON.stringify(runtimeLogSnapshot({ runId: before.runId, after }).entries);
    expect(output).not.toContain('SENSITIVE');
  });
  it('does not treat an unavailable proxy as an unavailable song or retry its refused connection', async () => {
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(new Error('failed'), '', 'ERROR: Unable to download webpage: [Errno 111] Connection refused'));
    await expect(new YtDlpExtractor('/installed/yt-dlp', 'ipv4', 'http://proxy.example').inspect('youtube', 'TwumA6YhQp4')).rejects.toMatchObject({ code: 'NETWORK_UNREACHABLE' });
    expect(mocks.exec).toHaveBeenCalledOnce();
  });
  it('uses bounded provider searches and rejects arbitrary URL inputs before spawning', async () => {
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(null, JSON.stringify(details()), ''));
    const adapter = new YtDlpExtractor('/installed/yt-dlp');
    expect(await adapter.search('youtube', 'Artist Track')).toHaveLength(1);
    expect(mocks.exec.mock.calls[0]![1].at(-1)).toBe('ytsearch20:Artist Track');
    await expect(adapter.inspect('youtube', 'http://169.254.169.254/')).rejects.toThrow(); expect(mocks.exec).toHaveBeenCalledOnce();
  });
  it('translates authorization failures without exposing stderr or signed URLs', async () => {
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(new Error('failed'), '', 'ERROR: Sign in to watch this video https://secret.example/token'));
    await expect(new YtDlpExtractor('/installed/yt-dlp').inspect('youtube', 'TwumA6YhQp4')).rejects.toThrow('YouTube вимагає авторизації');
    expect(mocks.exec).toHaveBeenCalledOnce();
  });
  it('retains useful extractor diagnostics while redacting signed URLs and credentials from runtime logs', async () => {
    const before = runtimeLogSnapshot(); const after = before.entries.at(-1)?.sequence ?? 0;
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(Object.assign(new Error('failed'), { code: 1, signal: null, killed: false }), '', 'ERROR: HTTP Error 403: Forbidden https://cdn.example/audio?signature=never-show token=never-show'));
    await expect(new YtDlpExtractor('/installed/yt-dlp').inspect('youtube', 'TwumA6YhQp4')).rejects.toThrow('відхилив доступ');
    const entries = runtimeLogSnapshot({ runId: before.runId, after }).entries;
    expect(entries.find((entry) => entry.action === 'extractor.failed')?.context).toMatchObject({ provider: 'youtube', operation: 'inspect', code: 1, killed: false, cancelled: false });
    expect(JSON.stringify(entries)).toContain('HTTP Error 403'); expect(JSON.stringify(entries)).not.toContain('never-show');
    expect(JSON.stringify(entries)).not.toContain('cdn.example');
  });
  it.each(['ENOENT', 'EACCES'])('distinguishes extractor startup %s from provider refusal', async (code) => {
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(Object.assign(new Error('cannot spawn'), { code }), '', ''));
    await expect(new YtDlpExtractor('/installed/yt-dlp').inspect('youtube', 'TwumA6YhQp4')).rejects.toThrow('запустити аудіоджерело');
    expect(mocks.exec).toHaveBeenCalledOnce();
  });
  it('classifies a killed extraction at its deadline as a timeout without spawning another process', async () => {
    vi.useFakeTimers();
    mocks.exec.mockImplementation((_file, _args, options, callback) => {
      vi.setSystemTime(Date.now() + options.timeout);
      callback(Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' }), '', '');
    });
    await expect(new YtDlpExtractor('/installed/yt-dlp').inspect('youtube', 'TwumA6YhQp4')).rejects.toThrow('відведений час');
    expect(mocks.exec).toHaveBeenCalledOnce();
  });
  it.each([
    'ERROR: HTTP Error 503: Service Unavailable',
    'ERROR: The read operation timed out',
  ])('recovers from one transient extraction failure within the original time budget: %s', async (stderr) => {
    vi.useFakeTimers();
    mocks.exec.mockImplementationOnce((_file, _args, _options, callback) => callback(new Error('failed'), '', stderr))
      .mockImplementationOnce((_file, _args, _options, callback) => callback(null, JSON.stringify(details()), ''));
    const result = new YtDlpExtractor('/installed/yt-dlp').inspect('youtube', 'https://music.youtube.com/watch?v=TwumA6YhQp4&si=share');
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toMatchObject({ id: 'TwumA6YhQp4' }); expect(mocks.exec).toHaveBeenCalledTimes(2);
    expect(mocks.exec.mock.calls[1]![1]).toEqual(mocks.exec.mock.calls[0]![1]);
    expect(mocks.exec.mock.calls[1]![2].timeout).toBe(19500);
  });
  it('does not immediately retry a bot-verification refusal or expose the upstream response', async () => {
    const before = runtimeLogSnapshot(); const after = before.entries.at(-1)?.sequence ?? 0;
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(new Error('failed'), '', 'ERROR: Sign in to confirm you’re not a bot https://secret.example/token'));
    const result = new YtDlpExtractor('/installed/yt-dlp').inspect('youtube', 'TwumA6YhQp4');
    await expect(result).rejects.toMatchObject({ code: 'NETWORK_BLOCKED', message: expect.stringContaining('адміністратору') });
    expect(mocks.exec).toHaveBeenCalledOnce();
    const entries = runtimeLogSnapshot({ runId: before.runId, after }).entries;
    expect(entries.find((entry) => entry.action === 'extractor.failed')?.context.sourceErrorCode).toBe('NETWORK_BLOCKED');
    expect(JSON.stringify(entries)).not.toContain('secret.example');
  });
  it('distinguishes missing outbound routing from a source timeout without retrying', async () => {
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(new Error('failed'), '', 'ERROR: Unable to download webpage: [Errno 101] Network is unreachable'));
    await expect(new YtDlpExtractor('/installed/yt-dlp', 'ipv6').inspect('youtube', 'TwumA6YhQp4')).rejects.toMatchObject({ code: 'NETWORK_UNREACHABLE' });
    expect(mocks.exec).toHaveBeenCalledOnce();
  });
  it('cancels a pending retry without spawning another process and releases the concurrency slot', async () => {
    vi.useFakeTimers(); const controller = new AbortController();
    mocks.exec.mockImplementationOnce((_file, _args, _options, callback) => callback(new Error('failed'), '', 'ERROR: Connection reset'))
      .mockImplementation((_file, _args, _options, callback) => callback(null, JSON.stringify(details()), ''));
    const adapter = new YtDlpExtractor('/installed/yt-dlp'); const result = adapter.inspect('youtube', 'TwumA6YhQp4', controller.signal);
    const failure = expect(result).rejects.toThrow('скасовано');
    await vi.advanceTimersByTimeAsync(0); controller.abort(); await failure; expect(mocks.exec).toHaveBeenCalledOnce();
    expect(await adapter.inspect('youtube', 'TwumA6YhQp4')).toMatchObject({ id: 'TwumA6YhQp4' });
  });
  it('does not restart extraction once its original deadline is exhausted', async () => {
    vi.useFakeTimers();
    mocks.exec.mockImplementation((_file, _args, _options, callback) => { vi.setSystemTime(Date.now() + 20000); callback(new Error('failed'), '', 'ERROR: Connection timed out'); });
    await expect(new YtDlpExtractor('/installed/yt-dlp').inspect('youtube', 'TwumA6YhQp4')).rejects.toThrow('тимчасово не відповідає');
    expect(mocks.exec).toHaveBeenCalledOnce();
  });
  it('does not mistake cookie advice in an unsupported-format error for a login requirement', async () => {
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(new Error('failed'), '', 'ERROR: Requested format is not available. Use cookies only if required.'));
    await expect(new YtDlpExtractor('/installed/yt-dlp').inspect('youtube', 'TwumA6YhQp4')).rejects.not.toThrow('авторизації');
    expect(mocks.exec).toHaveBeenCalledOnce();
  });
  it('reports missing executables without spawning a process', async () => {
    mocks.exists.mockReturnValue(false);
    const adapter = new YtDlpExtractor('/missing/yt-dlp'); expect(adapter.available()).toBe(false);
    await expect(adapter.inspect('youtube', 'TwumA6YhQp4')).rejects.toThrow('не встановлено'); expect(mocks.exec).not.toHaveBeenCalled();
  });
});

describe('hosting source failures', () => {
 it.each([
  "ERROR: Video unavailable. This content isn't available, try again later. The current session has been rate-limited",
  'ERROR: HTTP Error 429: Too Many Requests',
 ])('reports throttling without marking a public track private or retrying immediately: %s', async (stderr) => {
  mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(new Error('failed'), '', stderr));
  await expect(new YtDlpExtractor('/installed/yt-dlp').inspect('youtube', 'TwumA6YhQp4')).rejects.toThrow('тимчасово обмежив');
  expect(mocks.exec).toHaveBeenCalledOnce();
 });
 it.each([
  'ERROR: Video unavailable. Please try again later',
  'ERROR: HTTP Error 503: Service not available',
  'ERROR: Unable to download webpage: Temporary failure in name resolution',
  'ERROR: Video unavailable. See https://example.test/geographic-help',
 ])('recovers a temporary failure without falsely inferring removal: %s', async (stderr) => {
  vi.useFakeTimers();
  mocks.exec.mockImplementationOnce((_file, _args, _options, callback) => callback(new Error('failed'), '', stderr))
   .mockImplementationOnce((_file, _args, _options, callback) => callback(null, JSON.stringify(details()), ''));
  const result = new YtDlpExtractor('/installed/yt-dlp').inspect('youtube', 'TwumA6YhQp4');
  await vi.advanceTimersByTimeAsync(500); expect(await result).toMatchObject({ id: 'TwumA6YhQp4' }); expect(mocks.exec).toHaveBeenCalledTimes(2);
 });
 it.each(['Private video', 'This video has been removed by the uploader', 'The uploader has not made this video available in your country', 'HTTP Error 404: Not Found'])('preserves a permanent refusal without retries: %s', async (stderr) => {
  mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(new Error('failed'), '', stderr));
  await expect(new YtDlpExtractor('/installed/yt-dlp').inspect('youtube', 'TwumA6YhQp4')).rejects.toThrow('Трек недоступний'); expect(mocks.exec).toHaveBeenCalledOnce();
 });
 it.each([503, 502])('retries a temporary CDN HTTP %s once using the same validated source', async (status) => {
  vi.useFakeTimers(); const adapter = extractor(), provider = new OnlineAudioProvider('youtube', adapter), stream = new PassThrough();
  mocks.open.mockRejectedValueOnce(new MediaAudioHttpError(status)).mockResolvedValueOnce(stream);
  const result = provider.getPlayableResource('TwumA6YhQp4', new AbortController().signal);
  await vi.advanceTimersByTimeAsync(500); expect(await result).toBe(stream); expect(mocks.open).toHaveBeenCalledTimes(2); expect(adapter.inspect).toHaveBeenCalledOnce();
 });
 it('stops after a repeated temporary CDN failure and keeps signed URLs out of the error', async () => {
  vi.useFakeTimers(); mocks.open.mockRejectedValue(new MediaAudioHttpError(503));
  const result = new OnlineAudioProvider('youtube', extractor()).getPlayableResource('TwumA6YhQp4', new AbortController().signal);
  const failure = expect(result).rejects.toThrow('тимчасово не відповідає');
  await vi.advanceTimersByTimeAsync(500); await failure; expect(mocks.open).toHaveBeenCalledTimes(2);
 });
 it.each(['DNS timeout', 'Audio connection timeout'])('retries a transport deadline once: %s', async (message) => {
  vi.useFakeTimers(); const adapter = extractor(), stream = new PassThrough();
  mocks.open.mockRejectedValueOnce(Object.assign(new Error(message), { code: 'ETIMEDOUT' })).mockResolvedValueOnce(stream);
  const pending = new OnlineAudioProvider('youtube', adapter).getPlayableResource('TwumA6YhQp4', new AbortController().signal);
  await vi.advanceTimersByTimeAsync(500); expect(await pending).toBe(stream); expect(mocks.open).toHaveBeenCalledTimes(2); expect(adapter.inspect).toHaveBeenCalledOnce();
 });
 it('cancels CDN retry without another request', async () => {
  vi.useFakeTimers(); const controller = new AbortController(); mocks.open.mockRejectedValueOnce(new MediaAudioHttpError(503));
  const result = new OnlineAudioProvider('youtube', extractor()).getPlayableResource('TwumA6YhQp4', controller.signal);
  const failure = expect(result).rejects.toThrow('скасовано');
  await vi.advanceTimersByTimeAsync(0); controller.abort(); await failure; expect(mocks.open).toHaveBeenCalledOnce();
 });
});
