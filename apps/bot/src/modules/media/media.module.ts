import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { Client, Guild } from 'discord.js';
import type { GuildRepository, MediaRepository } from '@scrt/database';
import { createMediaSources, YtDlpExtractor } from '@scrt/media';
import { log } from '@scrt/shared';
import { MediaCommandService, MediaSessionService } from './command-service';
import type { EngineEvent, PlaybackEngine } from './playback-engine';
import { startMediaInternalApi } from './internal-api';

type Configuration = Parameters<typeof createMediaSources>[0] & { MEDIA_FFMPEG_PATH?: string; MEDIA_INTERNAL_SECRET?: string; MEDIA_INTERNAL_HOST: string; MEDIA_INTERNAL_PORT: number };
type GuildLease = { guild: Guild; workerId: string; expiresAt: number; timer: NodeJS.Timeout; pending: Promise<void> | null; unavailableReason: string | null };
export class MediaModule {
  readonly commands: MediaCommandService;
  private server: Server | null = null;
  private readonly leases = new Map<string, GuildLease>();
  private stopping = false;
  private constructor(client: Client, private readonly repository: MediaRepository, guilds: GuildRepository, private readonly env: Configuration, engineFactory: (event: (event: EngineEvent) => void) => PlaybackEngine, health: { available: boolean; ffmpeg: boolean; opus: boolean; dave: boolean }) {
    if (!health.available) log('warn', 'media', 'engine.degraded', health);
    const extractor = new YtDlpExtractor(); extractor.logDiagnostics();
    const sources = createMediaSources(env, extractor);
    for (const provider of sources.health()) log('info', 'media', 'source.configured', { provider: provider.id, state: provider.state, playback: provider.capabilities.playback });
    const sessions = new MediaSessionService(client, repository, guilds, sources, (_guildId, event) => engineFactory(event), health, (guildId) => !this.stopping && (this.leases.get(guildId)?.expiresAt ?? 0) > Date.now(), (guildId) => this.leases.get(guildId)?.unavailableReason ?? (this.leases.has(guildId) ? 'Підтвердження сесії прострочилося. Бот повторює підключення до Firebase; подробиці в логах.' : 'Медіа ще запускається для цього сервера. Дочекайтеся завершення відновлення.'));
    this.commands = new MediaCommandService(sessions);
  }
  static async create(client: Client, repository: MediaRepository, guilds: GuildRepository, env: Configuration) {
    try {
      const engine = await import('./playback-engine');
      log('info', 'media', 'engine.imported');
      const health = engine.playbackDependencies(env.MEDIA_FFMPEG_PATH);
      log('info', 'media', 'engine.dependencies.checked', health);
      return new MediaModule(client, repository, guilds, env, (event) => new engine.MediaPlaybackEngine(event, env.MEDIA_FFMPEG_PATH), health);
    }
    catch (error) { log('error', 'media', 'engine.load.failed', {}, error); return new MediaModule(client, repository, guilds, env, () => ({ connect: async () => { throw new Error('Media engine unavailable'); }, play: async () => { throw new Error('Media engine unavailable'); }, seek: async () => { throw new Error('Media engine unavailable'); }, pause() {}, resume() {}, volume() {}, stop() {}, destroy() {} }), { available: false, ffmpeg: false, opus: false, dave: false }); }
  }
  async start() { if (!this.env.MEDIA_INTERNAL_SECRET) { log('warn', 'media', 'internal.unconfigured'); return; } try { this.server = await startMediaInternalApi(this.commands, { secret: this.env.MEDIA_INTERNAL_SECRET, host: this.env.MEDIA_INTERNAL_HOST, port: this.env.MEDIA_INTERNAL_PORT }); log('info', 'media', 'internal.started', { host: this.env.MEDIA_INTERNAL_HOST, port: this.env.MEDIA_INTERNAL_PORT }); } catch (error) { log('error', 'media', 'internal.start.failed', {}, error); } }
  async recover(guild: Guild) {
    if (this.stopping) return;
    const existing = this.leases.get(guild.id);
    if (existing) { existing.guild = guild; return existing.pending; }
    const timer = setInterval(() => { void this.refreshLease(lease); }, 30000);
    const lease: GuildLease = { guild, workerId: randomUUID(), expiresAt: 0, timer, pending: null, unavailableReason: 'Бот відновлює медіасесію цього сервера. Дочекайтеся завершення.' };
    timer.unref(); this.leases.set(guild.id, lease);
    await this.refreshLease(lease);
  }
  private activeLease(lease: GuildLease): boolean { return !this.stopping && this.leases.get(lease.guild.id) === lease; }
  private refreshLease(lease: GuildLease): Promise<void> {
    if (lease.pending) return lease.pending;
    if (!this.activeLease(lease)) return Promise.resolve();
    lease.pending = this.renewLease(lease).finally(() => { lease.pending = null; });
    return lease.pending;
  }
  private async acquireLease(lease: GuildLease): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([this.repository.lease(lease.guild.id, lease.workerId), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Media lease timeout')), 8000);
      })]);
    } finally { clearTimeout(timer); }
  }
  private async suspendLease(lease: GuildLease) {
    const previouslyOwned = lease.expiresAt > 0;
    lease.expiresAt = 0;
    if (!previouslyOwned) return;
    this.commands.sessions.suspendAudio(lease.guild.id);
    await this.commands.sessions.interruptGuild(lease.guild.id, 'Media worker втратив право на сесію.').catch((error: unknown) => log('error', 'media', 'lease.interrupt.failed', { guildId: lease.guild.id }, error));
  }
  private async recoverWithLease(lease: GuildLease, acquiredUntil: number): Promise<number> {
    let expiresAt = acquiredUntil;
    let failure: Error | null = null;
    let renewal: Promise<void> | null = null;
    const canRecover = () => this.activeLease(lease) && lease.guild.available && !failure && expiresAt > Date.now();
    // Recovery may await cold Firestore reads/checkpoints longer than one lease.
    // Keep ownership alive, but leave the public command gate closed until done.
    const timer = setInterval(() => {
      if (renewal || !canRecover()) return;
      const requestedAt = Date.now();
      renewal = this.acquireLease(lease).then((acquired) => {
        if (!acquired || expiresAt <= Date.now()) throw new Error('Media lease lost during recovery');
        expiresAt = requestedAt + 60000;
      }).catch((error: unknown) => {
        failure = error instanceof Error ? error : new Error('Media lease renewal failed during recovery');
      }).finally(() => { renewal = null; });
    }, 30000);
    timer.unref();
    try {
      await this.commands.sessions.recover(lease.guild, canRecover);
    } finally {
      clearInterval(timer);
      await renewal;
    }
    if (failure) throw failure;
    if (!canRecover()) throw new Error('Media lease expired or stopped during recovery');
    return expiresAt;
  }
  private async renewLease(lease: GuildLease): Promise<void> {
    const guildId = lease.guild.id;
    const previouslyOwned = lease.expiresAt > Date.now();
    const requestedAt = Date.now();
    try {
      if (!lease.guild.available) { lease.unavailableReason = 'Discord-сервер тимчасово недоступний.'; await this.suspendLease(lease); return; }
      const acquired = await this.acquireLease(lease);
      if (!this.activeLease(lease)) return;
      if (!acquired) { lease.unavailableReason = 'Сесією керує інший процес бота. Очікуємо звільнення; перевірте, чи не запущено дві копії бота.'; await this.suspendLease(lease); log('warn', 'media', 'lease.occupied', { guildId }); return; }
      let expiresAt = requestedAt + 60000;
      if (!previouslyOwned) {
        lease.unavailableReason = 'Бот відновлює медіасесію цього сервера. Дочекайтеся завершення.';
        expiresAt = await this.recoverWithLease(lease, expiresAt);
        if (!this.activeLease(lease)) return;
        log('info', 'media', 'recovery.complete', { guildId, durationMs: Date.now() - requestedAt });
        void this.repository.pruneHistory(guildId).catch((error: unknown) => log('warn', 'media', 'history.cleanup.failed', { guildId }, error));
      }
      lease.expiresAt = expiresAt;
      lease.unavailableReason = null;
    } catch (error) { lease.unavailableReason = 'Не вдалося підтвердити або відновити медіасесію. Бот повторить спробу; причина помилки доступна в логах.'; await this.suspendLease(lease); log('error', 'media', 'lease.failed', { guildId }, error); }
  }
  async stopGuild(guildId: string) {
    const lease = this.leases.get(guildId);
    if (lease) { clearInterval(lease.timer); this.leases.delete(guildId); lease.expiresAt = 0; }
    this.commands.sessions.suspendAudio(guildId);
    await lease?.pending;
    await this.commands.sessions.forgetGuild(guildId);
    if (lease) await this.repository.lease(guildId, lease.workerId, true);
  }
  async shutdown() {
    this.stopping = true;
    this.server?.close(); this.server?.closeIdleConnections();
    const leases = [...this.leases.values()];
    for (const lease of leases) { clearInterval(lease.timer); lease.expiresAt = 0; this.commands.sessions.suspendAudio(lease.guild.id); }
    await Promise.allSettled(leases.flatMap((lease) => lease.pending ? [lease.pending] : []));
    await this.commands.sessions.shutdown();
    await Promise.allSettled(leases.map((lease) => this.repository.lease(lease.guild.id, lease.workerId, true)));
    this.leases.clear();
  }
}
