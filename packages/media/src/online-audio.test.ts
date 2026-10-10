import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ open: vi.fn(), exec: vi.fn(), exists: vi.fn(() => true) }));
vi.mock('node:child_process', () => ({ execFile: mocks.exec }));
vi.mock('node:fs', () => ({ existsSync: mocks.exists }));
vi.mock('./audio-http', async (original) => ({ ...await original<typeof import('./audio-http')>(), openAudioStream: mocks.open }));
import { createMediaSources, DirectAudioProvider, MediaSourceRegistry } from './providers';
import { MediaSourceError, OnlineAudioProvider, YtDlpExtractor, soundcloudReference, youtubeReference, type OnlineAudioExtractor } from './online-audio';
import { MediaAudioHttpError } from './audio-http';

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
  it.each(['youtube', 'soundcloud'] as const)('extracts only the next three %s results and bounds the page before spawning', async (provider) => {
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(null, `${JSON.stringify(details(provider))}\n${JSON.stringify(details(provider))}\n`, ''));
    const adapter = new YtDlpExtractor('/installed/yt-dlp'); await adapter.search(provider, 'Artist Track', 1);
    const args = mocks.exec.mock.calls[0]![1];
    expect(args.at(-1)).toBe(`${provider === 'youtube' ? 'ytsearch' : 'scsearch'}6:Artist Track`);
    expect(args[args.indexOf('--playlist-items') + 1]).toBe('4:6');
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
    expect(options.shell).toBeUndefined(); expect(options.signal).toBe(signal); expect(options.timeout).toBeGreaterThan(19000); expect(options.timeout).toBeLessThanOrEqual(20000);
    expect(options.env).not.toHaveProperty('DISCORD_BOT_TOKEN'); expect(options.env).not.toHaveProperty('NODE_OPTIONS');
  });
  it('uses bounded provider searches and rejects arbitrary URL inputs before spawning', async () => {
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(null, JSON.stringify(details()), ''));
    const adapter = new YtDlpExtractor('/installed/yt-dlp');
    expect(await adapter.search('youtube', 'Artist Track')).toHaveLength(1);
    expect(mocks.exec.mock.calls[0]![1].at(-1)).toBe('ytsearch3:Artist Track');
    await expect(adapter.inspect('youtube', 'http://169.254.169.254/')).rejects.toThrow(); expect(mocks.exec).toHaveBeenCalledOnce();
  });
  it('translates authorization failures without exposing stderr or signed URLs', async () => {
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(new Error('failed'), '', 'ERROR: Sign in to watch this video https://secret.example/token'));
    await expect(new YtDlpExtractor('/installed/yt-dlp').inspect('youtube', 'TwumA6YhQp4')).rejects.toThrow('YouTube вимагає авторизації');
    expect(mocks.exec).toHaveBeenCalledOnce();
  });
  it.each([
    'ERROR: Sign in to confirm you’re not a bot https://secret.example/token',
    'ERROR: HTTP Error 503: Service Unavailable',
    'ERROR: HTTP Error 429: Too Many Requests',
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
  it('stops after one repeated network refusal and never exposes the upstream response', async () => {
    vi.useFakeTimers();
    mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(new Error('failed'), '', 'ERROR: Sign in to confirm you’re not a bot https://secret.example/token'));
    const result = new YtDlpExtractor('/installed/yt-dlp').inspect('youtube', 'TwumA6YhQp4');
    const failure = expect(result).rejects.toThrow('YouTube тимчасово відхилив запит із мережі бота. Спробуйте ще раз трохи пізніше.');
    await vi.advanceTimersByTimeAsync(500); await failure; expect(mocks.exec).toHaveBeenCalledTimes(2);
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
