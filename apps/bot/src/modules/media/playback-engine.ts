import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { pipeline } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import type { AudioResource, VoiceConnection } from '@discordjs/voice';
import type { Guild } from 'discord.js';

// The supported CommonJS entry avoids a stalled ESM import under tsx watch on Windows.
const { AudioPlayerStatus, NoSubscriberBehavior, StreamType, VoiceConnectionStatus, createAudioPlayer, createAudioResource, entersState, joinVoiceChannel } = createRequire(import.meta.url)('@discordjs/voice') as typeof import('@discordjs/voice');

export type EngineEvent = { type: 'ended' | 'failed'; queueItemId: string; reason?: string } | { type: 'reconnecting' | 'reconnected' | 'disconnected' };
export interface PlaybackEngine {
  connect(guild: Guild, channelId: string, readyTimeoutMs?: number): Promise<void>;
  play(input: IncomingMessage, queueItemId: string, volume: number, maxSeconds: number | null, readyTimeoutMs?: number): Promise<void>;
  pause(): void; resume(): void; volume(value: number): void; stop(): void; destroy(): void;
}
export function playbackDependencies(ffmpeg = 'ffmpeg'): { available: boolean; ffmpeg: boolean; opus: boolean; dave: boolean } {
  const probe = spawnSync(ffmpeg, ['-version'], { timeout: 3000, windowsHide: true, stdio: 'ignore' });
  let opus = false; let dave = false;
  const require = createRequire(import.meta.url);
  try { opus = Boolean(require('opusscript')); } catch { /* optional engine dependency */ }
  try { dave = Boolean(require('@snazzah/davey')); } catch { /* engine unavailable */ }
  const availableFfmpeg = probe.status === 0;
  return { available: availableFfmpeg && opus && dave, ffmpeg: availableFfmpeg, opus, dave };
}
export class MediaPlaybackEngine implements PlaybackEngine {
  private connection: VoiceConnection | null = null;
  private readonly player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  private resource: AudioResource | null = null;
  private process: ChildProcessWithoutNullStreams | null = null;
  private input: IncomingMessage | null = null;
  private queueItemId: string | null = null;
  private reconnecting = false;
  private pausedBeforeReconnect = false;
  constructor(private readonly event: (event: EngineEvent) => void, private readonly ffmpeg = 'ffmpeg') {
    this.player.on(AudioPlayerStatus.Idle, () => { const id = this.queueItemId; if (id) { this.queueItemId = null; this.cleanup(); this.event({ type: 'ended', queueItemId: id }); } });
    this.player.on('error', () => this.fail('Помилка декодування аудіо.'));
  }
  async connect(guild: Guild, channelId: string, readyTimeoutMs = 15000): Promise<void> {
    if (this.connection?.joinConfig.channelId === channelId && this.connection.state.status === VoiceConnectionStatus.Ready) return;
    if (this.connection) { this.connection.removeAllListeners(); this.connection.destroy(); }
    this.reconnecting = false;
    this.connection = joinVoiceChannel({ guildId: guild.id, channelId, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true, selfMute: false });
    const connection = this.connection;
    connection.on('error', () => { if (this.connection === connection) this.event({ type: 'disconnected' }); });
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
        catch { if (this.connection === connection) this.event({ type: 'disconnected' }); }
        finally { if (this.connection === connection) this.reconnecting = false; }
      })();
    });
    await entersState(connection, VoiceConnectionStatus.Ready, readyTimeoutMs);
    connection.subscribe(this.player);
  }
  async play(input: IncomingMessage, queueItemId: string, volume: number, maxSeconds: number | null, readyTimeoutMs = 15000): Promise<void> {
    this.stop(); this.input = input; this.queueItemId = queueItemId;
    const args = ['-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'pipe', '-probesize', '1048576', '-analyzeduration', '5000000', '-i', 'pipe:0', '-map', '0:a:0', '-vn', '-sn', '-dn'];
    if (maxSeconds !== null) args.push('-t', String(maxSeconds));
    args.push('-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1');
    const process = spawn(this.ffmpeg, args, { windowsHide: true }); this.process = process;
    process.stderr.resume();
    process.once('error', () => { if (this.process === process) this.fail('FFmpeg недоступний.'); });
    process.once('close', (code) => { if (this.process === process && code !== 0) this.fail('Не вдалося декодувати джерело.'); });
    pipeline(input, process.stdin, (error) => { if (error && this.process === process) this.fail('Аудіопотік перервано.'); });
    this.resource = createAudioResource(process.stdout, { inputType: StreamType.Raw, inlineVolume: true });
    this.resource.volume?.setVolume(volume / 100); this.player.play(this.resource);
    await entersState(this.player, AudioPlayerStatus.Playing, readyTimeoutMs);
  }
  private fail(reason: string) { const id = this.queueItemId; if (!id) return; this.queueItemId = null; this.cleanup(); this.player.stop(true); this.event({ type: 'failed', queueItemId: id, reason }); }
  private cleanup() { this.input?.destroy(); this.input = null; const child = this.process; this.process = null; child?.kill('SIGKILL'); this.resource = null; }
  pause() {
    // Paused PCM applies backpressure upstream; intentional inactivity is not a failed source.
    this.input?.setTimeout(0);
    this.player.pause();
  }
  resume() { this.input?.setTimeout(15000); this.player.unpause(); }
  volume(value: number) { this.resource?.volume?.setVolume(value / 100); }
  stop() { this.queueItemId = null; this.player.stop(true); this.cleanup(); }
  destroy() { this.stop(); const connection = this.connection; this.connection = null; this.reconnecting = false; connection?.removeAllListeners(); if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy(); }
}
