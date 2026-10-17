import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { openAudioStream, readMediaDocument, validateMediaUrl, type MediaAudioStream } from './audio-http';

export const soundcloudAudioHosts = ['sndcdn.com', 'soundcloud.com', 'playback.media-streaming.soundcloud.cloud'];

function audioUrl(value: string, base?: string): string {
  const url = validateMediaUrl(base ? new URL(value, base).href : value);
  if (url.protocol !== 'https:' || !soundcloudAudioHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error('Недозволена адреса сегмента SoundCloud.');
  return url.href;
}

function segments(manifest: string, base: string): string[] {
  const lines = manifest.trim().split(/\r?\n/).map((line) => line.trim());
  if (lines[0] !== '#EXTM3U' || !lines.includes('#EXT-X-ENDLIST')) throw new Error('Підтримуються лише завершені HLS-треки SoundCloud.');
  const result: string[] = []; let mediaSegments = 0; let initialization = false;
  for (const line of lines) {
    // These variants need a separate demux/decryption path; never forward a manifest to FFmpeg.
    if (/^#EXT-X-(?:KEY:|SESSION-KEY:|BYTERANGE:|STREAM-INF:|MEDIA:|DISCONTINUITY|GAP)/.test(line)) throw new Error('Непідтримуваний HLS-формат SoundCloud.');
    if (line.startsWith('#EXT-X-MAP:')) {
      const uri = line.match(/^#EXT-X-MAP:URI="([^"\r\n]+)"$/)?.[1];
      if (!uri || initialization || mediaSegments) throw new Error('Некоректний початковий сегмент SoundCloud.');
      result.push(audioUrl(uri, base)); initialization = true;
    } else if (line && !line.startsWith('#')) {
      if (++mediaSegments > 4096) throw new Error('Забагато сегментів аудіо SoundCloud.');
      result.push(audioUrl(line, base));
    }
  }
  if (!mediaSegments) throw new Error('SoundCloud повернув порожній аудіопотік.');
  return result;
}

export async function openSoundCloudHls(value: string, signal: AbortSignal, headers: Record<string, string>): Promise<MediaAudioStream> {
  const url = audioUrl(value);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.throwIfAborted(); signal.addEventListener('abort', cancel, { once: true });
  let active: IncomingMessage | undefined;
  let output: MediaAudioStream | undefined;
  let timeoutMs = 15000;
  const updateTimeout = () => {
    const socket = active?.socket;
    if (active && !active.destroyed && !active.readableEnded && socket && !socket.destroyed) socket.setTimeout(timeoutMs);
  };
  const cleanup = () => { signal.removeEventListener('abort', cancel); controller.abort(); active?.destroy(); };
  const open = async (segment: string) => {
    active = await openAudioStream(segment, controller.signal, 0, undefined, headers, undefined, undefined, soundcloudAudioHosts);
    // Preparation may persist intent before the consumer attaches its pipeline.
    active.on('error', (error) => output?.destroy(error));
    updateTimeout(); return active;
  };
  try {
    const manifest = await readMediaDocument(url, { hosts: [new URL(url).hostname], contentTypes: ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'audio/x-mpegurl'], maxBytes: 1000000 }, controller.signal);
    const urls = segments(manifest, url);
    await open(urls[0]!);
    output = Readable.from((async function* () {
      try {
        for (let index = 0; index < urls.length; index++) {
          controller.signal.throwIfAborted();
          const stream = index === 0 ? active! : await open(urls[index]!);
          for await (const chunk of stream) yield chunk;
        }
        output!.complete = true;
      } finally { cleanup(); }
    })(), { objectMode: false });
    output.setReadTimeout = (value) => { timeoutMs = value; updateTimeout(); };
    output.on('error', () => undefined);
    output.once('close', cleanup);
    return output;
  } catch (error) { cleanup(); throw error; }
}
