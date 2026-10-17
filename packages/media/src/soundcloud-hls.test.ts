import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), open: vi.fn() }));
vi.mock('./audio-http', async (original) => ({ ...await original<typeof import('./audio-http')>(), readMediaDocument: mocks.read, openAudioStream: mocks.open }));
import { openSoundCloudHls, soundcloudAudioHosts } from './soundcloud-hls';

const base = 'https://playback.media-streaming.soundcloud.cloud/track/playlist.m3u8?token=secret';
const playlist = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:10,\nfirst.m4s\n#EXTINF:10,\nsecond.m4s\n#EXT-X-ENDLIST';
function segment(bytes?: string) {
  const stream = Object.assign(new PassThrough(), { socket: { setTimeout: vi.fn(), destroyed: false } });
  if (bytes !== undefined) stream.end(bytes);
  return stream;
}
afterEach(() => vi.resetAllMocks());

describe('SoundCloud public HLS audio', () => {
  it('streams initialization and media bytes in order, without forwarding the manifest to the decoder', async () => {
    mocks.read.mockResolvedValue(playlist);
    mocks.open.mockResolvedValueOnce(segment('init')).mockResolvedValueOnce(segment('first')).mockResolvedValueOnce(segment('second'));
    const stream = await openSoundCloudHls(base, new AbortController().signal, { 'User-Agent': 'SCRT' });
    expect(mocks.open).toHaveBeenCalledTimes(1);
    const bytes: Buffer[] = []; for await (const chunk of stream) bytes.push(chunk);
    expect(Buffer.concat(bytes).toString()).toBe('initfirstsecond'); expect(stream.complete).toBe(true);
    expect(mocks.open.mock.calls.map(([url]) => url)).toEqual(['init.mp4', 'first.m4s', 'second.m4s'].map((path) => new URL(path, base).href));
    expect(mocks.open.mock.calls.every((call) => call[7] === soundcloudAudioHosts)).toBe(true);
  });
  it('streams older MP3 playlists without an initialization segment', async () => {
    mocks.read.mockResolvedValue('#EXTM3U\n#EXTINF:10,\nhttps://cf-media.sndcdn.com/audio.mp3\n#EXT-X-ENDLIST');
    mocks.open.mockResolvedValue(segment('mp3'));
    const stream = await openSoundCloudHls(base, new AbortController().signal, {});
    const bytes: Buffer[] = []; for await (const chunk of stream) bytes.push(chunk);
    expect(Buffer.concat(bytes).toString()).toBe('mp3');
  });
  it('cancels a prepared segment when a newer track replaces it before consumption', async () => {
    mocks.read.mockResolvedValue(playlist); const first = segment(); mocks.open.mockResolvedValue(first);
    const controller = new AbortController(); const stream = await openSoundCloudHls(base, controller.signal, {});
    const requestSignal = mocks.open.mock.calls[0]![1] as AbortSignal;
    stream.destroy(); await new Promise<void>((resolve) => stream.once('close', resolve));
    expect(requestSignal.aborted).toBe(true); expect(first.destroyed).toBe(true);
    expect(mocks.open).toHaveBeenCalledOnce(); expect(controller.signal.aborted).toBe(false);
  });
  it('propagates cancellation while opening the manifest', async () => {
    const controller = new AbortController();
    mocks.read.mockImplementation((_url, _policy, signal: AbortSignal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })));
    const pending = openSoundCloudHls(base, controller.signal, {});
    const failure = expect(pending).rejects.toThrow('cancelled'); controller.abort(); await failure;
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it('propagates read timeout changes to a live segment socket', async () => {
    mocks.read.mockResolvedValue(playlist); const first = segment(); mocks.open.mockResolvedValue(first);
    const stream = await openSoundCloudHls(base, new AbortController().signal, {});
    stream.setReadTimeout!(0); expect(first.socket.setTimeout).toHaveBeenLastCalledWith(0);
    stream.setReadTimeout!(15000); expect(first.socket.setTimeout).toHaveBeenLastCalledWith(15000);
    stream.destroy();
  });
  it('surfaces a prepared segment failure before the decoder consumes it', async () => {
    mocks.read.mockResolvedValue(playlist); const first = segment(); mocks.open.mockResolvedValue(first);
    const stream = await openSoundCloudHls(base, new AbortController().signal, {});
    first.destroy(new Error('connection lost'));
    await new Promise<void>((resolve) => stream.once('close', resolve));
    expect(stream.errored?.message).toBe('connection lost');
  });
  it.each([
    '#EXTM3U\n#EXTINF:10,\nhttps://127.0.0.1/private\n#EXT-X-ENDLIST',
    '#EXTM3U\n#EXTINF:10,\nhttps://evil.example/audio\n#EXT-X-ENDLIST',
    '#EXTM3U\n#EXT-X-MAP:URI="https://sndcdn.com.evil.example/init.mp4"\ntrack.m4s\n#EXT-X-ENDLIST',
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\ntrack.m4s\n#EXT-X-ENDLIST',
    '#EXTM3U\n#EXT-X-BYTERANGE:10@0\ntrack.m4s\n#EXT-X-ENDLIST',
    '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=160000\nvariant.m3u8\n#EXT-X-ENDLIST',
    '#EXTM3U\ntrack.m4s',
    '#EXTM3U\n#EXT-X-ENDLIST',
  ])('rejects unsafe or unsupported manifests before opening audio: %s', async (manifest) => {
    mocks.read.mockResolvedValue(manifest);
    await expect(openSoundCloudHls(base, new AbortController().signal, {})).rejects.toThrow();
    expect(mocks.open).not.toHaveBeenCalled();
  });
});
