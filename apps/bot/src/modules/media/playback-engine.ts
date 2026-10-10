import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { pipeline } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import type { AudioPlayerError, AudioResource, VoiceConnection } from '@discordjs/voice';
import type { Guild } from 'discord.js';
import { log } from '@scrt/shared';
import { audioStreamRequestId } from '@scrt/media';

// The supported CommonJS entry avoids a stalled ESM import under tsx watch on Windows.
const { AudioPlayerStatus, NoSubscriberBehavior, StreamType, VoiceConnectionStatus, createAudioPlayer, createAudioResource, entersState, joinVoiceChannel } = createRequire(import.meta.url)('@discordjs/voice') as typeof import('@discordjs/voice');
// Each Discord audio frame lasts 20 ms. Allow short network/CPU stalls before failing.
const maxMissedFrames = 150;
function setReadTimeout(input: IncomingMessage, timeoutMs: number): void {
  // HTTP can finish and detach its socket while buffered audio is still playing.
  // Only a live, unread response owns a socket inactivity timer.
  const socket = input.socket;
  if (!input.destroyed && !input.readableEnded && socket && !socket.destroyed) socket.setTimeout(timeoutMs);
}

export type EngineEvent = { type: 'ended' | 'failed'; queueItemId: string; reason?: string; playedMs?: number } | { type: 'reconnecting' | 'reconnected' | 'disconnected' };
export interface PlaybackEngine {
  connect(guild: Guild, channelId: string, readyTimeoutMs?: number): Promise<void>;
  play(input: IncomingMessage, queueItemId: string, volume: number, maxSeconds: number | null, readyTimeoutMs?: number, beforeCommit?: () => Promise<void>): Promise<void>;
  seek(input: IncomingMessage, queueItemId: string, volume: number, maxSeconds: number, positionMs: number, paused: boolean, beforeCommit: () => Promise<void>, readyTimeoutMs?: number): Promise<void>;
  pause(): void; resume(): void; volume(value: number): void; stop(): void; destroy(): void;
}
export function playbackDependencies(ffmpeg = 'ffmpeg'): { available: boolean; ffmpeg: boolean; opus: boolean; dave: boolean } {
  const probe = spawnSync(ffmpeg, ['-version'], { timeout: 3000, windowsHide: true, encoding: 'utf8', maxBuffer: 64000 });
  log(probe.status === 0 ? 'info' : 'error', 'media', 'decoder.dependencies.checked', { available: probe.status === 0, version: probe.stdout?.split(/\r?\n/)[0], code: probe.status, signal: probe.signal }, probe.error);
  let opus = false; let dave = false;
  const require = createRequire(import.meta.url);
  try { opus = Boolean(require('opusscript')); } catch { /* optional engine dependency */ }
  try { dave = Boolean(require('@snazzah/davey')); } catch { /* engine unavailable */ }
  const availableFfmpeg = probe.status === 0;
  return { available: availableFfmpeg && opus && dave, ffmpeg: availableFfmpeg, opus, dave };
}
export class MediaPlaybackEngine implements PlaybackEngine {
  private connection: VoiceConnection | null = null;
  private readonly player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause, maxMissedFrames } });
  private resource: AudioResource | null = null;
  private process: ChildProcessWithoutNullStreams | null = null;
  private input: IncomingMessage | null = null;
  private queueItemId: string | null = null;
  private reconnecting = false;
  private pausedBeforeReconnect = false;
  private generation = 0;
  private cancelPreparation: (() => void) | null = null;
  private guildId: string | null = null;
  constructor(private readonly event: (event: EngineEvent) => void, private readonly ffmpeg = 'ffmpeg') {
    this.player.on('stateChange', (previous, next) => log('info', 'media', 'player.state', { guildId: this.guildId, queueItemId: this.queueItemId, from: previous.status, to: next.status }));
    this.player.on(AudioPlayerStatus.Idle, (previous) => {
      const id = this.queueItemId;
      if (!id || !('resource' in previous) || previous.resource !== this.resource) return;
      const playedMs = previous.resource.playbackDuration;
      const missedFrames = 'missedFrames' in previous ? previous.missedFrames : 0;
      // The player destroys its stream BEFORE emitting Idle. resource.ended is then
      // true even after starvation; readableEnded distinguishes actual decoded EOF.
      const decodedEof = previous.resource.playStream.readableEnded;
      log(decodedEof && missedFrames < maxMissedFrames ? 'info' : 'error', 'media', 'player.idle', {
        guildId: this.guildId, queueItemId: id, playedMs, missedFrames, decodedEof,
        sourceComplete: this.input?.complete, decoderExited: this.process?.exitCode != null,
      });
      if (!decodedEof || missedFrames >= maxMissedFrames) {
        this.fail('Аудіопотік перервано або надто довго не надходять аудіокадри. Трек збережено для повторного запуску.');
        return;
      }
      log('info', 'media', 'audio.ended', { guildId: this.guildId, queueItemId: id, playedMs });
      this.queueItemId = null; this.cleanup();
      this.event({ type: 'ended', queueItemId: id, ...(playedMs === undefined ? {} : { playedMs }) });
    });
    this.player.on('error', (error: AudioPlayerError) => { if (error.resource === this.resource) { log('error', 'media', 'player.error', { guildId: this.guildId, queueItemId: this.queueItemId }, error); this.fail('Помилка декодування аудіо.'); } });
  }
  async connect(guild: Guild, channelId: string, readyTimeoutMs = 15000): Promise<void> {
    this.guildId = guild.id;
    if (this.connection?.joinConfig.channelId === channelId && this.connection.state.status === VoiceConnectionStatus.Ready) return;
    if (this.connection) { this.connection.removeAllListeners(); this.connection.destroy(); }
    this.reconnecting = false;
    this.connection = joinVoiceChannel({ guildId: guild.id, channelId, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true, selfMute: false });
    const connection = this.connection;
    connection.on('stateChange', (previous, next) => log('info', 'media', 'voice.state', { guildId: guild.id, channelId, from: previous.status, to: next.status }));
    connection.on('error', (error) => { if (this.connection === connection) { log('error', 'media', 'voice.error', { guildId: guild.id, channelId }, error); this.event({ type: 'disconnected' }); } });
    connection.on(VoiceConnectionStatus.Disconnected, () => {
      if (this.connection !== connection || this.reconnecting) return;
      this.reconnecting = true; this.pausedBeforeReconnect = this.player.state.status === AudioPlayerStatus.Paused;
      this.pause(); this.event({ type: 'reconnecting' });
      void (async () => {
        try {
          await Promise.race([entersState(connection, VoiceConnectionStatus.Signalling, 5000), entersState(connection, VoiceConnectionStatus.Connecting, 5000)]);
          if (this.connection !== connection) return;
          await entersState(connection, VoiceConnectionStatus.Ready, 15000);
          if (this.connection !== connection) return;
          if (!this.pausedBeforeReconnect) this.resume();
          this.event({ type: 'reconnected' });
        }
        catch (error) { if (this.connection === connection) { log('error', 'media', 'voice.reconnect.failed', { guildId: guild.id, channelId }, error); this.event({ type: 'disconnected' }); } }
        finally { if (this.connection === connection) this.reconnecting = false; }
      })();
    });
    await entersState(connection, VoiceConnectionStatus.Ready, readyTimeoutMs);
    connection.subscribe(this.player);
  }
  async play(input: IncomingMessage, queueItemId: string, volume: number, maxSeconds: number | null, readyTimeoutMs = 15000, beforeCommit?: () => Promise<void>): Promise<void> {
    if (beforeCommit) {
      await this.replace(input, queueItemId, volume, maxSeconds, 0, false, beforeCommit, readyTimeoutMs);
      const resource = this.resource;
      await entersState(this.player, AudioPlayerStatus.Playing, readyTimeoutMs);
      if (!resource || this.resource !== resource || this.queueItemId !== queueItemId) throw new Error('Відтворення перервано під час запуску.');
      return;
    }
    this.stop(); this.input = input; this.queueItemId = queueItemId;
    const decoded = this.decode(input, queueItemId, volume, maxSeconds, 0, (child, reason) => { if (this.process === child) this.fail(reason); });
    this.process = decoded.process; this.resource = decoded.resource;
    this.player.play(decoded.resource);
    await entersState(this.player, AudioPlayerStatus.Playing, readyTimeoutMs);
    if (this.resource !== decoded.resource || this.queueItemId !== queueItemId) throw new Error('Відтворення перервано під час запуску.');
  }
  private decode(input: IncomingMessage, queueItemId: string, volume: number, maxSeconds: number | null, positionMs: number, failed: (child: ChildProcessWithoutNullStreams, reason: string) => void) {
    // Backpressure is expected: decoded audio is consumed at realtime speed.
    // A socket inactivity timer must run only while the pipeline wants bytes.
    const updateTimeout = () => setReadTimeout(input, input.isPaused() ? 0 : 15000);
    const detachTimeoutUpdates = () => {
      input.off('pause', updateTimeout); input.off('resume', updateTimeout);
      input.off('end', detachTimeoutUpdates); input.off('close', detachTimeoutUpdates);
    };
    input.on('pause', updateTimeout); input.on('resume', updateTimeout);
    input.once('end', detachTimeoutUpdates); input.once('close', detachTimeoutUpdates);
    const args = ['-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'pipe', '-probesize', '1048576', '-analyzeduration', '5000000', '-i', 'pipe:0', '-map', '0:a:0', '-vn', '-sn', '-dn'];
    // Output seeking works on validated stdin bytes; FFmpeg never opens URLs.
    if (positionMs > 0) args.push('-ss', String(positionMs / 1000));
    if (maxSeconds !== null) args.push('-t', String(maxSeconds - positionMs / 1000));
    args.push('-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1');
    const process = spawn(this.ffmpeg, args, { windowsHide: true });
    const diagnostic = { guildId: this.guildId, queueItemId, positionMs, pid: process.pid, sourceRequestId: audioStreamRequestId(input) };
    log('info', 'media', 'decoder.started', diagnostic);
    let stderr = ''; let exited = false; let receivedBytes = 0;
    // Attach synchronously with pipeline; diagnostics must never consume bytes
    // while a source is awaiting preparation or persistence.
    const countBytes = (chunk: Buffer) => { receivedBytes += chunk.length; };
    input.on('data', countBytes);
    input.once('close', () => {
      input.off('data', countBytes);
      log(!input.complete && !process.killed && !exited ? 'warn' : 'info', 'media', 'source.stream.closed', {
        ...diagnostic, receivedBytes, contentLength: input.headers?.['content-length'], complete: input.complete,
        aborted: input.aborted, intentional: process.killed || exited,
      });
    });
    process.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-4000); });
    process.once('error', (error) => { log('error', 'media', 'decoder.spawn.failed', diagnostic, error); failed(process, 'FFmpeg недоступний.'); });
    process.once('exit', () => { exited = true; });
    process.once('close', (code, signal) => {
      log(code === 0 || process.killed ? 'info' : 'error', 'media', 'decoder.closed', { ...diagnostic, code, signal, intentional: process.killed, receivedBytes, stderr });
      if (code !== 0) failed(process, 'Не вдалося декодувати джерело.');
    });
    pipeline(input, process.stdin, (error) => { if (error && !exited && !process.killed) { log('error', 'media', 'source.stream.failed', diagnostic, error); failed(process, 'Аудіопотік перервано.'); } });
    try {
      const resource = createAudioResource(process.stdout, { inputType: StreamType.Raw, inlineVolume: true });
      resource.playStream.on('error', () => undefined);
      resource.volume?.setVolume(volume / 100); return { process, resource };
    } catch (error) { input.destroy(); process.kill('SIGKILL'); throw error; }
  }
  async seek(input: IncomingMessage, queueItemId: string, volume: number, maxSeconds: number, positionMs: number, paused: boolean, beforeCommit: () => Promise<void>, readyTimeoutMs = 15000): Promise<void> {
    if (!Number.isSafeInteger(positionMs) || positionMs < 0 || positionMs >= maxSeconds * 1000) { input.destroy(); throw new Error('Перемотування недоступне.'); }
    await this.replace(input, queueItemId, volume, maxSeconds, positionMs, paused, beforeCommit, readyTimeoutMs);
  }
  private async replace(input: IncomingMessage, queueItemId: string, volume: number, maxSeconds: number | null, positionMs: number, paused: boolean, beforeCommit: () => Promise<void>, readyTimeoutMs: number): Promise<void> {
    if (this.cancelPreparation || this.reconnecting) { input.destroy(); throw new Error('Заміна аудіо недоступна.'); }
    const generation = this.generation;
    let rejectReady!: (error: Error) => void; let resolveReady!: () => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    void ready.catch(() => undefined);
    let failure: string | null = null;
    const decoded = this.decode(input, queueItemId, volume, maxSeconds, positionMs, (child, reason) => {
      if (this.process === child) this.fail(reason);
      else { failure = reason; rejectReady(new Error(reason)); }
    });
    const stream = decoded.resource.playStream;
    const unavailable = () => rejectReady(new Error('Не вдалося підготувати аудіо.'));
    // A readable event can also signal EOF with no packets (invalid/empty audio).
    const readable = () => { if (stream.readableLength > 0) resolveReady(); else unavailable(); };
    stream.once('readable', readable); stream.once('error', unavailable); stream.once('end', unavailable); stream.once('close', unavailable);
    const cancel = () => rejectReady(new Error('Заміна аудіо скасована.'));
    this.cancelPreparation = cancel;
    const timeout = setTimeout(unavailable, readyTimeoutMs);
    let committed = false;
    try {
      if (stream.readableLength > 0) resolveReady();
      await ready;
      await beforeCommit();
      if (failure || generation !== this.generation || this.reconnecting || stream.destroyed || stream.readableLength === 0 || decoded.resource.ended) throw new Error(failure ?? 'Заміна аудіо скасована.');
      this.cancelPreparation = null;
      this.stop(); this.input = input; this.process = decoded.process; this.resource = decoded.resource; this.queueItemId = queueItemId;
      this.player.play(decoded.resource); committed = true;
      if (paused) this.pause();
    } finally {
      clearTimeout(timeout); if (this.cancelPreparation === cancel) this.cancelPreparation = null;
      stream.off('readable', readable); stream.off('error', unavailable); stream.off('end', unavailable); stream.off('close', unavailable);
      if (!committed) { input.destroy(); decoded.process.kill('SIGKILL'); stream.destroy(); }
    }
  }
  private fail(reason: string) { const id = this.queueItemId; if (!id) return; log('error', 'media', 'audio.failed', { guildId: this.guildId, queueItemId: id, reason, playedMs: this.resource?.playbackDuration }); this.queueItemId = null; this.cleanup(); this.player.stop(true); this.event({ type: 'failed', queueItemId: id, reason }); }
  private cleanup() { const input = this.input; const child = this.process; this.input = null; this.process = null; this.resource = null; input?.destroy(); child?.kill('SIGKILL'); }
  pause() {
    // Paused PCM applies backpressure upstream; intentional inactivity is not a failed source.
    if (this.input) setReadTimeout(this.input, 0);
    this.player.pause();
  }
  resume() { if (this.input) setReadTimeout(this.input, this.input.isPaused() ? 0 : 15000); this.player.unpause(); }
  volume(value: number) { this.resource?.volume?.setVolume(value / 100); }
  stop() { this.generation++; this.cancelPreparation?.(); this.cancelPreparation = null; this.queueItemId = null; this.player.stop(true); this.cleanup(); }
  destroy() { this.stop(); const connection = this.connection; this.connection = null; this.reconnecting = false; connection?.removeAllListeners(); if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy(); }
}
