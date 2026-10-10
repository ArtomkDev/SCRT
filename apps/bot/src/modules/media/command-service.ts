import { randomUUID, createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { ChannelType, PermissionFlagsBits, type Client, type Guild, type GuildMember, type VoiceState } from 'discord.js';
import { PermissionService, mediaPolicy, type MediaActor } from '@scrt/permissions';
import type { GuildRepository, MediaStore } from '@scrt/database';
import { mediaCommandSchema, mediaSettingsSchema, type MediaAction, type MediaCommand, type MediaSettings } from '@scrt/validation';
import { log, type MediaHistoryItem, type MediaQueueItem, type MediaSession, type MediaTrack } from '@scrt/shared';
import { countedVotes, scheduledQueue, voteThreshold, MediaSourceError, MediaAudioHttpError, type MediaSourceRegistry } from '@scrt/media';
import type { EngineEvent, PlaybackEngine } from './playback-engine';

export class MediaError extends Error { constructor(message: string, readonly status = 409) { super(message); } }
type Actor = MediaActor & { member: GuildMember; guild: Guild };
type PreparedPlayback = { stream: IncomingMessage; claimed: boolean };
type Runtime = { session: MediaSession | null; engine: PlaybackEngine; votes: Set<string>; emptyTimer: NodeJS.Timeout | null; emptyPaused: boolean; reconnectState: MediaSession['state'] | null };
export class MediaSessionService {
  private readonly runtimes = new Map<string, Runtime>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private stopping = false;
  constructor(private readonly client: Client, private readonly store: MediaStore, private readonly guilds: Pick<GuildRepository, 'accessMappings'>, readonly sources: MediaSourceRegistry,
    private readonly engineFactory: (guildId: string, event: (event: EngineEvent) => void) => PlaybackEngine, readonly engineHealth: { available: boolean; ffmpeg: boolean; opus: boolean; dave: boolean }, private readonly ownsGuild: (guildId: string) => boolean = () => true) {}
  async exclusive<T>(guildId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(guildId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation); this.pending.set(guildId, next);
    try { return await next; } finally { if (this.pending.get(guildId) === next) this.pending.delete(guildId); }
  }
  private async runtime(guildId: string, recoverActive = true, canRecover: () => boolean = () => true): Promise<Runtime> {
    let runtime = this.runtimes.get(guildId);
    if (!runtime) {
      const session = await this.store.getSession(guildId);
      if (!canRecover()) throw new MediaError('Медіасесія недоступна під час відновлення.', 503);
      runtime = { session, engine: this.engineFactory(guildId, (event) => { void this.onEngineEvent(guildId, event).catch((error: unknown) => this.failClosed(guildId, error)); }), votes: new Set(), emptyTimer: null, emptyPaused: false, reconnectState: null };
      if (recoverActive && runtime.session && (runtime.session.currentTrack || !['idle', 'error'].includes(runtime.session.state))) {
        const previous = runtime.session.revision;
        this.interrupt(runtime, 'Відтворення було перервано перезапуском SCRT.');
        runtime.session.sessionId = randomUUID();
        await this.save(runtime, previous, [], 'session.recovered', null);
      }
      this.runtimes.set(guildId, runtime);
    }
    return runtime;
  }
  async actor(guildId: string, userId: string): Promise<Actor> {
    if (this.stopping) throw new MediaError('Media worker недоступний.', 503);
    if (!this.client.isReady()) throw new MediaError('SCRT ще не підключився до Discord. Дочекайтеся запуску бота й повторіть спробу.', 503);
    if (!this.ownsGuild(guildId)) throw new MediaError('Media worker недоступний.', 503);
    const guild = this.client.guilds.cache.get(guildId); if (!guild?.available) throw new MediaError('Сервер недоступний.', 403);
    const [member, mappings] = await Promise.all([
      guild.members.fetch({ user: userId, force: true }).catch(() => null), this.guilds.accessMappings(guildId),
    ]);
    if (!member || member.id !== userId || guild.id !== guildId || member.user.bot) throw new MediaError('Учасника не знайдено.', 403);
    const permissions = new PermissionService().permissionsFor({ guildId, userId: member.id, ownerId: guild.ownerId, discordRoleIds: [...member.roles.cache.keys()], mappings: mappings.roles, memberMappings: mappings.members });
    if (!permissions.has('media.view')) throw new MediaError('Недостатньо прав для Медіа.', 403);
    return { userId: member.id, permissions, roleIds: [...member.roles.cache.keys()], voiceChannelId: guild.voiceStates.cache.get(member.id)?.channelId ?? null, member, guild };
  }
  private listeners(guild: Guild, session: MediaSession | null): string[] { return session ? [...guild.voiceStates.cache.values()].filter((state) => state.channelId === session.voiceChannelId && state.member && !state.member.user.bot).map((state) => state.id) : []; }
  private async eligibleVoice(actor: Pick<Actor, 'guild'>, channelId: string, settings: MediaSettings) {
    const channel = await actor.guild.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice || channelId === actor.guild.afkChannelId || settings.blockedVoiceChannelIds.includes(channelId) || (settings.allowedVoiceChannelIds.length && !settings.allowedVoiceChannelIds.includes(channelId) && !(channel.parentId && settings.allowedCategoryIds.includes(channel.parentId))) || (!settings.allowedVoiceChannelIds.length && settings.allowedCategoryIds.length && !settings.allowedCategoryIds.includes(channel.parentId ?? ''))) throw new MediaError('Цей голосовий канал не дозволений для Медіа.', 403);
    const self = await actor.guild.members.fetchMe(); const effective = channel.permissionsFor(self);
    if (!effective?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) throw new MediaError('SCRT потребує View Channel, Connect і Speak у цьому каналі.', 403);
    return channel;
  }
  private activeSession(session: MediaSession | null) { return session && (session.currentTrack || session.recoverable || session.queue.length || session.state !== 'idle') ? session : null; }
  private requirePolicy(settings: MediaSettings, actor: Actor, session: MediaSession | null, type: string, ownerId?: string) {
    const error = mediaPolicy(settings, actor, session, type, ownerId); if (error) throw new MediaError(error, 403);
  }
  private validateTrack(track: MediaTrack, settings: MediaSettings) {
    if (!track.playable) throw new MediaError(track.provider === 'youtube' || track.provider === 'soundcloud' ? 'Для цього треку немає доступного публічного аудіопотоку.' : 'Це джерело підтримує лише інформацію.');
    if (track.type === 'live' && !settings.allowLiveStreams) throw new MediaError('Прямі трансляції вимкнено.');
    if (track.durationMs && track.durationMs > settings.maxTrackDurationSeconds * 1000) throw new MediaError('Трек перевищує дозволену тривалість.');
    if (settings.explicitPolicy === 'block' && track.explicit === true) throw new MediaError('Explicit треки заборонено.');
  }
  private appendSearch(session: MediaSession, actor: Actor, settings: MediaSettings, tracks: MediaTrack[]) {
    const active = [session.currentTrack, ...session.queue].filter((item): item is MediaQueueItem => Boolean(item));
    const identities = new Set(active.map((item) => JSON.stringify([item.provider, item.providerItemId])));
    let count = active.length, ownCount = active.filter((item) => item.requestedByUserId === actor.userId).length;
    for (const track of tracks) {
      const key = JSON.stringify([track.provider, track.providerItemId]);
      if (identities.has(key)) continue;
      try { this.validateTrack(track, settings); } catch (error) { if (error instanceof MediaError) continue; throw error; }
      if (count >= settings.maxQueueItems || ownCount >= settings.maxTracksPerUser) break;
      session.queue.push({ ...track, queueItemId: randomUUID(), requestedByUserId: actor.userId, requestedByName: actor.member.displayName.slice(0, 100), requestedAt: Date.now() });
      identities.add(key); count++; ownCount++;
    }
  }
  private async prepareSearch(references: NonNullable<Extract<MediaAction, { type: 'PLAY_TRACK' }>['following']>, session: MediaSession | null, selected: MediaTrack, limit: number, settings: MediaSettings): Promise<{ tracks: MediaTrack[]; incomplete: boolean }> {
    const identities = new Set([selected, ...(session?.queue ?? [])].map((item) => JSON.stringify([item.provider, item.providerItemId])));
    const candidates = references.filter((reference) => {
      const key = JSON.stringify([reference.provider, reference.providerItemId]);
      if (identities.has(key)) return false;
      identities.add(key); return true;
    }).map((reference) => ({ reference, known: this.sources.searchedTrack(reference.provider, reference.providerItemId) ?? session?.played.find((item) => item.provider === reference.provider && item.providerItemId === reference.providerItemId) ?? null })).filter(({ known }) => {
      if (!known) return true;
      try { this.validateTrack(known, settings); return true; } catch (error) { if (error instanceof MediaError) return false; throw error; }
    }).slice(0, Math.max(0, limit));
    if (!candidates.length) return { tracks: [], incomplete: false };
    const abort = new AbortController();
    const tracks = candidates.map(({ known }) => known);
    const missing = candidates.flatMap((candidate, position) => candidate.known ? [] : [{ reference: candidate.reference, position }]);
    let index = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Optional continuation must not reject the selected song or monopolize extraction.
      // Populate cached entries first so slow cache misses cannot hide later valid songs.
      const resolving = Promise.all(Array.from({ length: Math.min(4, missing.length) }, async () => {
        while (index < missing.length && !abort.signal.aborted) {
          const { reference, position } = missing[index++]!;
          try {
            const track = await this.sources.get(reference.provider).resolve(reference.providerItemId, abort.signal);
            if (abort.signal.aborted) return;
            if (track.provider !== reference.provider || track.providerItemId !== reference.providerItemId) continue;
            this.validateTrack(track, settings);
            tracks[position] = track;
          } catch { /* Unavailable continuation is omitted; selected audio remains independent. */ }
        }
      }));
      await Promise.race([resolving, new Promise<void>((resolve) => { timer = setTimeout(() => { abort.abort(); resolve(); }, 2000); })]);
      const available = tracks.filter((track): track is MediaTrack => track !== null);
      const incomplete = available.length !== candidates.length;
      if (incomplete) log('warn', 'media', 'continuation.incomplete', { guildId: session?.guildId, provider: selected.provider, requested: candidates.length, added: available.length });
      return { tracks: available, incomplete };
    } finally { clearTimeout(timer); abort.abort(); }
  }
  private reorder(session: MediaSession, settings: MediaSettings, actor: Actor, item: MediaQueueItem, position: number) {
    const ordered = scheduledQueue(session.queue, session.queueMode, session.lastRequesterId);
    const from = ordered.findIndex((entry) => entry.queueItemId === item.queueItemId); const to = Math.min(position, ordered.length - 1);
    const crossing = ordered.slice(Math.min(from, to), Math.max(from, to) + 1);
    if (session.queueMode === 'fair' && crossing.some((entry) => entry.requestedByUserId !== item.requestedByUserId)) throw new MediaError('Справедлива черга дозволяє змінювати порядок лише в межах одного учасника.');
    if (mediaPolicy(settings, actor, session, 'MOVE_QUEUE_ITEM', undefined) && crossing.some((entry) => entry.requestedByUserId !== actor.userId)) throw new MediaError('Власні треки можна переміщувати лише між власними треками.', 403);
    ordered.splice(from, 1); ordered.splice(to, 0, item); session.queue = ordered; session.queueVersion++;
  }
  private async save(runtime: Runtime, priorRevision: number | null, history: MediaHistoryItem[], action: string, actorId: string | null, receipt?: { commandId: string; fingerprint: string }) {
    if (!runtime.session) return;
    runtime.session.revision = (priorRevision ?? -1) + 1; runtime.session.updatedAt = Date.now();
    await this.store.checkpoint(runtime.session, priorRevision, history, { action, actorId }, receipt);
  }
  async recover(guild: Guild, canRecover: () => boolean = () => true) {
    return this.exclusive(guild.id, async () => {
      if (!canRecover()) throw new MediaError('Медіасесія недоступна під час відновлення.', 503);
      const cached = this.runtimes.get(guild.id);
      cached?.engine.destroy();
      if (cached?.emptyTimer) clearTimeout(cached.emptyTimer);
      this.runtimes.delete(guild.id);
      const runtime = await this.runtime(guild.id, false, canRecover); const session = runtime.session; if (!session) return;
      const previous = session.revision; runtime.engine.destroy(); runtime.votes.clear();
      if (session.currentTrack) session.queue.unshift(session.currentTrack);
      session.currentTrack = null; session.state = 'idle'; session.recoverable = session.queue.length > 0; session.startedAt = null; session.pausedAt = null; session.accumulatedPauseMs = 0; session.playbackOffsetMs = 0;
      session.sessionId = randomUUID(); session.queueVersion++; session.lastError = session.recoverable ? 'Відтворення було перервано перезапуском SCRT.' : null;
      if (!canRecover()) throw new MediaError('Медіасесія недоступна під час відновлення.', 503);
      await this.save(runtime, previous, [], 'session.recovered', null);
    });
  }
  async state(guildId: string, userId: string) {
    return this.exclusive(guildId, async () => {
      const [actor, settings] = await Promise.all([this.actor(guildId, userId), this.store.getSettings(guildId)]);
      return this.snapshot(actor, await this.runtime(guildId), settings);
    });
  }
  private snapshot(actor: Actor, runtime: Runtime, settings: MediaSettings) {
      actor.voiceChannelId = actor.guild.voiceStates.cache.get(actor.userId)?.channelId ?? null;
      const session = runtime.session; const listeners = this.listeners(actor.guild, session);
      const controls = Object.fromEntries(['ADD_TRACK', 'PLAY_TRACK', 'SEEK', 'PAUSE', 'RESUME', 'SKIP', 'VOTE_SKIP', 'STOP', 'RESTORE', 'MOVE_SESSION', 'SET_VOLUME', 'SET_REPEAT', 'SET_SHUFFLE', 'SET_LOCK'].map((type) => [type, mediaPolicy(settings, actor, type === 'ADD_TRACK' || type === 'PLAY_TRACK' ? this.activeSession(session) : session, type) === null]));
      controls.SEEK = Boolean(controls.SEEK && session?.currentTrack?.seekable && session.currentTrack.type === 'track' && session.currentTrack.durationMs && ['playing', 'paused'].includes(session.state));
      const queueControls = Object.fromEntries([...(session?.played ?? []), ...(session?.queue ?? [])].map((item) => [item.queueItemId, { remove: !mediaPolicy(settings, actor, session, 'REMOVE_QUEUE_ITEM', item.requestedByUserId), move: Boolean(session?.queue.some((entry) => entry.queueItemId === item.queueItemId)) && !mediaPolicy(settings, actor, session, 'MOVE_QUEUE_ITEM', item.requestedByUserId) }]));
      const displaySession = session ? { ...session, queue: scheduledQueue(session.queue, session.queueMode, session.lastRequesterId) } : null;
      return { session: displaySession, settings, controls, queueControls, actorVoice: { id: actor.voiceChannelId, name: actor.member.voice.channel?.name ?? null }, remoteControl: Boolean(session && actor.voiceChannelId !== session.voiceChannelId && actor.permissions.has('media.manage') && settings.allowRemoteAdminControl), listenerCount: listeners.length, votes: { count: countedVotes(runtime.votes, listeners), required: voteThreshold(listeners, settings.skipVoteRatio) }, providers: this.sources.health(), engine: this.engineHealth, serverTimestamp: Date.now(), canManage: actor.permissions.has('media.manage') };
  }
  async search(guildId: string, userId: string, query: string, page = 0) { await this.actor(guildId, userId); return this.sources.search(query, page); }
  async settings(guildId: string, userId: string, input: MediaSettings) {
    return this.exclusive(guildId, async () => {
      const actor = await this.actor(guildId, userId); if (!actor.permissions.has('media.manage')) throw new MediaError('Потрібен дозвіл media.manage.', 403);
      const settings = mediaSettingsSchema.parse(input); const runtime = await this.runtime(guildId);
      const [channels, roles] = await Promise.all([actor.guild.channels.fetch(), actor.guild.roles.fetch()]);
      if (settings.djRoleIds.some((id) => id === guildId || !roles.has(id)) || [...settings.allowedVoiceChannelIds, ...settings.blockedVoiceChannelIds].some((id) => channels.get(id)?.type !== ChannelType.GuildVoice) || settings.allowedCategoryIds.some((id) => channels.get(id)?.type !== ChannelType.GuildCategory)) throw new MediaError('Виберіть чинні ресурси цього сервера.', 400);
      let interruption: string | null = !settings.enabled ? 'Модуль Медіа вимкнено.' : null;
      if (settings.enabled && runtime.session?.currentTrack) {
        try { await this.eligibleVoice(actor, runtime.session.voiceChannelId, settings); }
        catch (error) { if (!(error instanceof MediaError)) throw error; interruption = error.message; }
      }
      await this.store.saveSettings(guildId, settings, actor.userId);
      runtime.votes.clear();
      if (runtime.session) { const prior = runtime.session.revision; if (interruption) this.interrupt(runtime, interruption); if (runtime.session.volume > settings.maxVolume) { runtime.session.volume = settings.maxVolume; runtime.engine.volume(settings.maxVolume); } runtime.session.queueMode = settings.queueMode; runtime.session.queueVersion++; await this.save(runtime, prior, [], settings.enabled ? 'media.enabled' : 'media.disabled', userId); }
      return settings;
    });
  }
  async execute(input: MediaCommand) {
    const command = mediaCommandSchema.parse(input);
    return this.exclusive(command.guildId, async () => {
      try { return await this.executeLocked(command); }
      catch (error) {
        if (error instanceof MediaError && error.status === 422) {
          log('warn', 'media', 'command.source.rejected', { guildId: command.guildId, commandType: command.action.type, provider: 'provider' in command.action ? command.action.provider : undefined, status: error.status, reason: error.message });
        }
        if (!(error instanceof MediaError)) await this.failClosed(command.guildId, error);
        throw error;
      }
    });
  }
  private async executeLocked(command: MediaCommand) {
    const [actor, settings, priorReceipt] = await Promise.all([this.actor(command.guildId, command.actorUserId), this.store.getSettings(command.guildId), this.store.receipt(command.guildId, command.commandId)]);
    const runtime = await this.runtime(command.guildId); const action = command.action; const session = runtime.session;
    const fingerprint = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    const reply = (replayed = false, warning?: string) => ({ replayed, snapshot: this.snapshot(actor, runtime, settings), ...(warning ? { warning } : {}) });
    if (priorReceipt) { if (priorReceipt.fingerprint !== fingerprint) throw new MediaError('Command ID already used'); return reply(true); }
    if ((session?.sessionId ?? null) !== command.sessionId) throw new MediaError('Сесія змінилася. Оновіть плеєр.');
    if ((session?.queueVersion ?? null) !== command.expectedQueueVersion) throw new MediaError('Черга або поточний трек змінилися. Оновіть плеєр.');
    const candidates = action.type === 'SEEK' ? session?.currentTrack ? [session.currentTrack] : [] : [...(session?.queue ?? []), ...(action.type === 'REMOVE_QUEUE_ITEM' ? session?.played ?? [] : [])];
    const item = 'queueItemId' in action ? candidates.find((entry) => entry.queueItemId === action.queueItemId) : undefined;
    this.requirePolicy(settings, actor, action.type === 'ADD_TRACK' || action.type === 'PLAY_TRACK' ? this.activeSession(session) : session, action.type, item?.requestedByUserId);
    if ('expectedQueueVersion' in action && action.expectedQueueVersion !== session?.queueVersion) throw new MediaError('Черга змінилася. Оновіть плеєр.');
    if ('queueItemId' in action && !item) throw new MediaError('Трек уже видалено.');
    const history: MediaHistoryItem[] = []; const priorRevision = session?.revision ?? null;
    if (action.type === 'ADD_TRACK' || action.type === 'PLAY_TRACK') {
      const playNow = action.type === 'PLAY_TRACK';
      if (!this.engineHealth.available) throw new MediaError('Аудіодвигун недоступний. Перевірте FFmpeg, Opus і DAVE.', 503);
      let track: MediaTrack;
      try { track = await this.sources.get(action.provider).resolve(action.providerItemId, AbortSignal.timeout(15000)); }
      catch (error) { throw new MediaError(error instanceof MediaSourceError ? error.message : 'Не вдалося підготувати трек. Спробуйте ще раз або виберіть інший.', 422); }
      this.validateTrack(track, settings);
      // Resolution can take seconds: re-read actual Gateway location before any join/control.
      actor.voiceChannelId = actor.guild.voiceStates.cache.get(actor.userId)?.channelId ?? null; this.requirePolicy(settings, actor, this.activeSession(session), action.type);
      const active = session?.currentTrack ? [session.currentTrack, ...session.queue] : session?.queue ?? [];
      const duplicate = active.find((entry) => entry.provider === track.provider && entry.providerItemId === track.providerItemId);
      if (playNow && duplicate?.queueItemId === session?.currentTrack?.queueItemId && duplicate) throw new MediaError('Цей трек уже грає.');
      if (!playNow && duplicate && settings.duplicatePolicy === 'reject') throw new MediaError('Цей трек уже в черзі.');
      if (!playNow && duplicate && settings.duplicatePolicy === 'allow' && duplicate.requestedByUserId === actor.userId) throw new MediaError('Ви вже додали цей трек.');
      if (!playNow && duplicate && settings.duplicatePolicy === 'move_existing') {
        this.requirePolicy(settings, actor, session, 'MOVE_QUEUE_ITEM', duplicate.requestedByUserId);
        if (session?.currentTrack?.queueItemId === duplicate.queueItemId) throw new MediaError('Цей трек уже грає.');
        this.reorder(session!, settings, actor, duplicate, 0);
      } else {
        const replacing = playNow ? session?.currentTrack : null;
        const count = active.length - Number(Boolean(replacing));
        const ownCount = active.filter((entry) => entry.requestedByUserId === actor.userId).length - Number(replacing?.requestedByUserId === actor.userId);
        if (!(playNow && duplicate) && (count >= settings.maxQueueItems || ownCount >= settings.maxTracksPerUser)) throw new MediaError('Досягнуто ліміту черги або треків на учасника.');
        const added = Number(!(playNow && duplicate));
        const targetId = this.activeSession(session)?.voiceChannelId ?? actor.voiceChannelId!;
        const channel = playNow || !this.activeSession(session) ? await this.eligibleVoice(actor, targetId, settings) : null;
        // Open the replacement source while the current track is still playing.
        // A provider/HTTP failure must not tear down the active session.
        const prepared = playNow ? await this.preparePlayback(track) : undefined;
        try {
          const following = action.type === 'PLAY_TRACK' ? await this.prepareSearch(action.following ?? [], session, track, Math.min(settings.maxQueueItems - count - added, settings.maxTracksPerUser - ownCount - added), settings) : { tracks: [], incomplete: false };
          actor.voiceChannelId = actor.guild.voiceStates.cache.get(actor.userId)?.channelId ?? null;
          this.requirePolicy(settings, actor, this.activeSession(session), action.type);
          if (channel && !this.activeSession(session) && actor.voiceChannelId !== targetId) throw new MediaError('Голосовий канал змінився. Оновіть плеєр і повторіть відтворення.', 403);
          if (!session || !this.activeSession(session)) runtime.session = { sessionId: randomUUID(), guildId: command.guildId, voiceChannelId: channel!.id, voiceChannelName: channel!.name, state: 'idle', currentTrack: null, queue: [], played: session?.played ?? [], startedAt: null, pausedAt: null, accumulatedPauseMs: 0, volume: Math.min(session?.volume ?? settings.defaultVolume, settings.maxVolume), repeatMode: 'off', queueMode: settings.queueMode, shuffle: false, lockedMode: 'unlocked', createdByUserId: actor.userId, queueVersion: 0, revision: session?.revision ?? 0, createdAt: Date.now(), updatedAt: Date.now(), recoverable: false, lastError: null, lastRequesterId: null };
          else if (channel) { session.voiceChannelId = channel.id; session.voiceChannelName = channel.name; }
          const current = runtime.session!;
          const selected = playNow && duplicate ? { ...duplicate, ...track } : { ...track, queueItemId: randomUUID(), requestedByUserId: actor.userId, requestedByName: actor.member.displayName.slice(0, 100), requestedAt: Date.now() };
          if (playNow && prepared) {
            try { await this.switchSelected(runtime, actor, settings, selected, following.tracks, prepared, priorRevision, { commandId: command.commandId, fingerprint }); }
            catch (error) { if (error instanceof MediaError) runtime.session = session; throw error; }
            return reply(false, following.incomplete ? 'Вибраний трек запущено. Частину добірки не додано; повторіть пошук, щоб оновити її.' : undefined);
          }
          current.queue.push(selected);
          current.queueVersion++;
          // Persist intent before creating audible effects, so a crash cannot lose the queued track.
          await this.save(runtime, priorRevision, history, 'track.added', actor.userId, { commandId: command.commandId, fingerprint });
          history.length = 0;
          if (!current.currentTrack && !current.recoverable) { await this.advance(runtime, actor.guild, settings, history); await this.save(runtime, current.revision, history, 'playback.started', actor.userId); }
          return reply();
        } finally { if (prepared && !prepared.claimed) prepared.stream.destroy(); }
      }
    } else {
      if (!session) throw new MediaError('Немає активної сесії.');
      if (session.recoverable && !['RESTORE', 'STOP', 'REMOVE_QUEUE_ITEM', 'MOVE_QUEUE_ITEM', 'SET_VOLUME', 'SET_REPEAT', 'SET_SHUFFLE', 'SET_LOCK'].includes(action.type)) throw new MediaError('Спочатку відновіть перервану сесію.');
      switch (action.type) {
        case 'SEEK': await this.seekCurrent(runtime, actor, settings, action.positionMs); break;
        case 'PAUSE': if (session.state !== 'playing') throw new MediaError('Відтворення вже призупинено.'); runtime.engine.pause(); session.pausedAt = Date.now(); session.state = 'paused'; runtime.emptyPaused = false; break;
        case 'RESUME': if (session.state !== 'paused') throw new MediaError('Немає призупиненого треку.'); runtime.engine.resume(); session.accumulatedPauseMs += Date.now() - (session.pausedAt ?? Date.now()); session.pausedAt = null; session.state = 'playing'; runtime.emptyPaused = false; break;
        case 'RESTORE': {
          if (!session.recoverable || !this.engineHealth.available) throw new MediaError('Відновлення недоступне.');
          const targetId = actor.voiceChannelId!;
          const channel = await this.eligibleVoice(actor, targetId, settings);
          if (actor.guild.voiceStates.cache.get(actor.userId)?.channelId !== targetId) throw new MediaError('Голосовий канал змінився. Оновіть плеєр і повторіть відновлення.', 403);
          runtime.engine.destroy(); session.voiceChannelId = channel.id; session.voiceChannelName = channel.name;
          session.recoverable = false; session.lastError = null;
          await this.advance(runtime, actor.guild, settings, history); break;
        }
        case 'SKIP': case 'VOTE_SKIP': {
          if (!session.currentTrack) throw new MediaError('Немає поточного треку.');
          if (action.type === 'VOTE_SKIP') { runtime.votes.add(actor.userId); const listeners = this.listeners(actor.guild, session); if (countedVotes(runtime.votes, listeners) < voteThreshold(listeners, settings.skipVoteRatio)) break; }
          this.finish(runtime, 'skipped', history); await this.advance(runtime, actor.guild, settings, history); break;
        }
        case 'STOP': this.finish(runtime, 'skipped', history, 'Сесію зупинено.'); this.interrupt(runtime, null); session.sessionId = randomUUID(); break;
        case 'MOVE_SESSION': {
          const targetId = actor.voiceChannelId!;
          const channel = await this.eligibleVoice(actor, targetId, settings); const paused = session.state === 'paused';
          if (actor.guild.voiceStates.cache.get(actor.userId)?.channelId !== targetId) throw new MediaError('Голосовий канал змінився. Оновіть плеєр і повторіть переміщення.', 403);
          runtime.engine.stop(); session.voiceChannelId = channel.id; session.voiceChannelName = channel.name;
          if (session.currentTrack) { await this.play(runtime, actor.guild, settings); if (paused) { runtime.engine.pause(); session.state = 'paused'; session.pausedAt = Date.now(); } session.lastError = 'SCRT переміщено. Поточний трек почався спочатку.'; }
          break;
        }
        case 'REMOVE_QUEUE_ITEM': session.queue = session.queue.filter((entry) => entry.queueItemId !== action.queueItemId); session.played = session.played.filter((entry) => entry.queueItemId !== action.queueItemId); session.queueVersion++; break;
        case 'MOVE_QUEUE_ITEM': {
          this.reorder(session, settings, actor, item!, action.position); break;
        }
        case 'SET_VOLUME': if (action.volume > settings.maxVolume) throw new MediaError('Гучність перевищує ліміт.'); session.volume = action.volume; runtime.engine.volume(action.volume); break;
        case 'SET_REPEAT': session.repeatMode = action.repeatMode; break;
        case 'SET_SHUFFLE': session.shuffle = action.shuffle; if (action.shuffle) { for (let i = session.queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [session.queue[i], session.queue[j]] = [session.queue[j]!, session.queue[i]!]; } session.queueVersion++; } break;
        case 'SET_LOCK': if (action.lockedMode === 'admin' && !actor.permissions.has('media.manage')) throw new MediaError('Потрібен media.manage.', 403); session.lockedMode = action.lockedMode; runtime.votes.clear(); break;
      }
    }
    const auditActions: Record<string, string> = { SEEK: 'playback.seeked', PAUSE: 'playback.paused', RESUME: 'playback.resumed', RESTORE: 'session.restored', SKIP: 'track.skipped', VOTE_SKIP: history.length ? 'track.skipped' : 'track.vote', STOP: 'session.stopped', MOVE_SESSION: 'session.moved', REMOVE_QUEUE_ITEM: 'track.removed', MOVE_QUEUE_ITEM: 'queue.reordered', SET_VOLUME: 'volume.changed', SET_REPEAT: 'repeat.changed', SET_SHUFFLE: 'shuffle.changed', SET_LOCK: 'session.locked', ADD_TRACK: 'queue.reordered' };
    await this.save(runtime, priorRevision, history, auditActions[action.type]!, actor.userId, { commandId: command.commandId, fingerprint });
    return reply();
  }
  private finish(runtime: Runtime, result: MediaHistoryItem['result'], history: MediaHistoryItem[], reason: string | null = null, repeat = true, stopAudio = true) {
    const session = runtime.session!; if (stopAudio) runtime.engine.stop(); const track = session.currentTrack;
    if (track) {
      history.push({ id: randomUUID(), track, playedAt: session.startedAt ?? Date.now(), endedAt: Date.now(), result, reason }); session.lastRequesterId = track.requestedByUserId;
      if (result !== 'failed') session.played = [...session.played.filter((item) => item.provider !== track.provider || item.providerItemId !== track.providerItemId), track].slice(-100);
    }
    session.currentTrack = null; session.startedAt = null; session.pausedAt = null; session.accumulatedPauseMs = 0; session.playbackOffsetMs = 0; runtime.votes.clear(); session.queueVersion++;
    if (repeat && track && result === 'finished' && session.repeatMode === 'track') { session.queue.unshift({ ...track, queueItemId: randomUUID() }); session.lastRequesterId = null; }
    else if (repeat && track && result !== 'failed' && session.repeatMode === 'queue') session.queue.push({ ...track, queueItemId: randomUUID() });
  }
  private async preparePlayback(track: MediaTrack): Promise<PreparedPlayback> {
    const abort = new AbortController(); const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const stream = await this.sources.get(track.provider).getPlayableResource(track.providerItemId, abort.signal);
      // The checkpoint can yield before the engine installs its pipeline handler.
      // Keep stream errors handled during that gap; play checks errored/destroyed.
      stream.on('error', () => undefined);
      if (abort.signal.aborted || stream.destroyed || stream.errored) { stream.destroy(); throw new Error('Audio stream closed'); }
      return { stream, claimed: false };
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : '';
      const transportCode = ['ETIMEDOUT', 'EAI_AGAIN', 'ECONNRESET', 'ENETUNREACH', 'ECONNREFUSED', 'ABORT_ERR'].includes(code) ? code : undefined;
      log('warn', 'media', 'source.open.failed', { provider: track.provider, transportCode, upstreamStatus: error instanceof MediaAudioHttpError ? error.status : undefined, timedOut: abort.signal.aborted });
      throw new MediaError(error instanceof MediaSourceError ? error.message : 'Не вдалося завантажити аудіо. Спробуйте ще раз або виберіть інший трек.', 422);
    }
    finally { clearTimeout(timeout); }
  }
  private async switchSelected(runtime: Runtime, actor: Actor, settings: MediaSettings, selected: MediaQueueItem, following: MediaTrack[], prepared: PreparedPlayback, priorRevision: number | null, receipt: { commandId: string; fingerprint: string }) {
    const session = runtime.session!; let intentStarted = false;
    const beforeCommit = async () => {
      await this.eligibleVoice(actor, session.voiceChannelId, settings);
      actor.voiceChannelId = actor.guild.voiceStates.cache.get(actor.userId)?.channelId ?? null;
      this.requirePolicy(settings, actor, this.activeSession(session), 'PLAY_TRACK');
      if (this.stopping || !this.ownsGuild(actor.guild.id) || !this.listeners(actor.guild, session).length) throw new MediaError('Медіасесія недоступна.', 503);
      const history: MediaHistoryItem[] = [];
      intentStarted = true;
      // Decoder packets are ready. Persist the selected identity before the engine
      // atomically replaces audio; preparation failure leaves the old track intact.
      this.finish(runtime, 'skipped', history, 'Вибрано інший трек.', false, false);
      session.queue = session.queue.filter((entry) => entry.queueItemId !== selected.queueItemId);
      session.played = session.played.filter((entry) => entry.provider !== selected.provider || entry.providerItemId !== selected.providerItemId);
      session.currentTrack = selected; session.state = 'buffering'; session.recoverable = false; session.lastError = null; session.queueVersion++;
      this.appendSearch(session, actor, settings, following);
      await this.save(runtime, priorRevision, history, 'track.selected', actor.userId, receipt);
    };
    // A failed Voice connection has an unknown audio outcome; let the outer
    // boundary stop/recover it rather than claiming a reversible source rejection.
    await runtime.engine.connect(actor.guild, session.voiceChannelId);
    try {
      await runtime.engine.play(prepared.stream, selected.queueItemId, session.volume, selected.type === 'live' ? null : settings.maxTrackDurationSeconds, 15000, beforeCommit);
    } catch (error) {
      // Once intent has changed, fail closed and recover persisted state rather
      // than reporting a reversible rejection while different audio is active.
      if (intentStarted) throw new Error('Не вдалося завершити перемикання аудіо.', { cause: error });
      if (error instanceof MediaError) throw error;
      throw new MediaError(`Не вдалося підготувати аудіо вибраного треку.${session.currentTrack ? ' Поточний трек збережено.' : ' Спробуйте ще раз або виберіть інший трек.'}`, 422);
    }
    prepared.claimed = true;
    session.state = 'playing'; session.startedAt = Date.now(); session.pausedAt = null; session.accumulatedPauseMs = 0; session.playbackOffsetMs = 0;
    await this.save(runtime, session.revision, [], 'playback.started', actor.userId);
  }
  private async seekCurrent(runtime: Runtime, actor: Actor, settings: MediaSettings, positionMs: number) {
    const session = runtime.session!; const current = session.currentTrack!;
    if (!['playing', 'paused'].includes(session.state) || !current.seekable || current.type !== 'track' || !current.durationMs || positionMs >= current.durationMs) throw new MediaError('Перемотування для цього треку або позиції недоступне.', 422);
    let resolved: MediaTrack;
    try { resolved = await this.sources.get(current.provider).resolve(current.providerItemId, AbortSignal.timeout(15000)); }
    catch (error) { throw new MediaError(error instanceof MediaSourceError ? error.message : 'Не вдалося підготувати перемотування.', 422); }
    this.validateTrack(resolved, settings);
    if (!resolved.seekable || resolved.type !== 'track' || !resolved.durationMs || positionMs >= Math.min(resolved.durationMs, settings.maxTrackDurationSeconds * 1000)) throw new MediaError('Джерело не підтримує цю позицію треку.', 422);
    const prepared = await this.preparePlayback(resolved);
    try {
      const beforeCommit = async () => {
        await this.eligibleVoice(actor, session.voiceChannelId, settings);
        actor.voiceChannelId = actor.guild.voiceStates.cache.get(actor.userId)?.channelId ?? null;
        this.requirePolicy(settings, actor, session, 'SEEK');
        if (this.stopping || !this.ownsGuild(actor.guild.id) || !this.listeners(actor.guild, session).length) throw new MediaError('Медіасесія недоступна.', 503);
      };
      await beforeCommit();
      const paused = session.state === 'paused'; const queueItemId = randomUUID();
      try { await runtime.engine.seek(prepared.stream, queueItemId, session.volume, settings.maxTrackDurationSeconds, positionMs, paused, beforeCommit); }
      catch (error) { if (error instanceof MediaError) throw error; throw new MediaError('Не вдалося перемотати трек. Спробуйте іншу позицію.', 422); }
      prepared.claimed = true;
      // A fresh identity rejects late end/error events from the old position.
      session.currentTrack = { ...current, ...resolved, queueItemId };
      session.playbackOffsetMs = positionMs; session.startedAt = Date.now(); session.pausedAt = paused ? session.startedAt : null; session.accumulatedPauseMs = 0;
      session.queueVersion++; session.lastError = null; runtime.votes.clear();
    } finally { if (!prepared.claimed) prepared.stream.destroy(); }
  }
  private async advance(runtime: Runtime, guild: Guild, settings: MediaSettings, history: MediaHistoryItem[]) {
    const session = runtime.session!;
    if (session.queue.length) {
      try {
        if (!settings.enabled) throw new MediaError('Модуль Медіа вимкнено.');
        await this.eligibleVoice({ guild }, session.voiceChannelId, settings);
      } catch (error) {
        if (!(error instanceof MediaError)) throw error;
        this.interrupt(runtime, error.message); return;
      }
    }
    const deadline = Date.now() + 45000;
    // Bound consecutive source failures and total transition time; failed tracks never repeat.
    let attempts = 0;
    while (session.queue.length && attempts++ < 3 && Date.now() < deadline) {
      if (!this.listeners(guild, session).length) { this.interrupt(runtime, 'Voice порожній. Чергу збережено.'); return; }
      const next = scheduledQueue(session.queue, session.queueMode, session.lastRequesterId)[0]!;
      session.queue = session.queue.filter((item) => item.queueItemId !== next.queueItemId);
      session.played = session.played.filter((item) => item.provider !== next.provider || item.providerItemId !== next.providerItemId);
      session.currentTrack = next; session.queueVersion++; runtime.votes.clear();
      try { await this.play(runtime, guild, settings, deadline); return; }
      catch (error) { if (this.stopping || !this.ownsGuild(guild.id) || !this.listeners(guild, session).length) { this.interrupt(runtime, 'Media worker недоступний або Voice порожній. Чергу збережено.'); return; } session.lastError = error instanceof MediaError || error instanceof MediaSourceError ? error.message : 'Не вдалося відтворити трек. Перехід до наступного.'; this.finish(runtime, 'failed', history, session.lastError); }
    }
    runtime.engine.destroy(); session.state = 'idle'; session.recoverable = session.queue.length > 0;
  }
  private async play(runtime: Runtime, guild: Guild, settings: MediaSettings, deadline = Date.now() + 45000) {
    if (this.stopping || !this.ownsGuild(guild.id)) throw new MediaError('Media worker недоступний.', 503);
    const remaining = () => Math.max(1, Math.min(15000, deadline - Date.now()));
    const session = runtime.session!;
    // Stored/search metadata never authorizes audio: refresh source restrictions at playback.
    const resolved = await this.sources.get(session.currentTrack!.provider).resolve(session.currentTrack!.providerItemId);
    this.validateTrack(resolved, settings); session.currentTrack = { ...session.currentTrack!, ...resolved };
    session.state = 'connecting'; await runtime.engine.connect(guild, session.voiceChannelId, remaining());
    session.state = 'buffering'; const abort = new AbortController();
    const track = session.currentTrack!;
    const timeout = setTimeout(() => abort.abort(), remaining());
    let stream;
    try { stream = await this.sources.get(track.provider).getPlayableResource(track.providerItemId, abort.signal); }
    finally { clearTimeout(timeout); }
    if (stream.destroyed || stream.errored) { stream.destroy(); throw new MediaError('Аудіопотік перервано.', 422); }
    if (this.stopping || !this.ownsGuild(guild.id) || !this.listeners(guild, session).length) { stream.destroy(); throw new MediaError('Media worker недоступний або у Voice немає слухачів.', 503); }
    await runtime.engine.play(stream, track.queueItemId, session.volume, track.type === 'live' ? null : settings.maxTrackDurationSeconds, remaining());
    session.state = 'playing'; session.startedAt = Date.now(); session.pausedAt = null; session.accumulatedPauseMs = 0; session.playbackOffsetMs = 0; session.recoverable = false; session.lastError = null;
  }
  private interrupt(runtime: Runtime, reason: string | null) {
    const session = runtime.session; if (!session) return;
    runtime.engine.destroy(); if (runtime.emptyTimer) clearTimeout(runtime.emptyTimer); runtime.emptyTimer = null; runtime.votes.clear();
    runtime.emptyPaused = false; runtime.reconnectState = null;
    if (session.currentTrack) session.queue.unshift(session.currentTrack);
    session.currentTrack = null; session.state = 'idle'; session.recoverable = session.queue.length > 0; session.startedAt = null; session.pausedAt = null; session.accumulatedPauseMs = 0; session.playbackOffsetMs = 0; session.queueVersion++; session.lastError = reason;
  }
  private async onEngineEvent(guildId: string, event: EngineEvent) {
    await this.exclusive(guildId, async () => {
      const runtime = this.runtimes.get(guildId); const session = runtime?.session; const guild = this.client.guilds.cache.get(guildId); if (!runtime || !session || !guild || this.stopping) return;
      const previous = session.revision; const settings = await this.store.getSettings(guildId); const history: MediaHistoryItem[] = [];
      if ('queueItemId' in event) {
        if (session.currentTrack?.queueItemId !== event.queueItemId) return;
        this.finish(runtime, event.type === 'ended' ? 'finished' : 'failed', history, event.reason ?? null);
        if (event.type === 'failed') session.lastError = event.reason ?? 'Помилка відтворення.';
        await this.advance(runtime, guild, settings, history);
      } else if (event.type === 'disconnected') this.interrupt(runtime, 'Голосове з’єднання перервано. Відновіть сесію.');
      else if (event.type === 'reconnecting') { runtime.reconnectState = session.state; session.state = 'reconnecting'; if (!session.pausedAt) session.pausedAt = Date.now(); }
      else { session.state = runtime.reconnectState === 'paused' ? 'paused' : 'playing'; if (session.state === 'playing') { session.accumulatedPauseMs += Date.now() - (session.pausedAt ?? Date.now()); session.pausedAt = null; } }
      await this.save(runtime, previous, history, `engine.${event.type}`, null);
    });
  }
  async voiceState(oldState: VoiceState, newState: VoiceState) {
    if (oldState.channelId === newState.channelId) return;
    await this.exclusive(newState.guild.id, async () => {
      const runtime = this.runtimes.get(newState.guild.id); const session = runtime?.session; if (!runtime || !session || this.stopping) return;
      const previous = session.revision; const settings = await this.store.getSettings(session.guildId);
      const before = JSON.stringify(session);
      if (newState.id === this.client.user?.id && oldState.channelId === session.voiceChannelId && newState.channelId !== oldState.channelId && !['idle', 'connecting', 'stopping'].includes(session.state)) {
        if (!newState.channelId) this.interrupt(runtime, 'SCRT від’єднано від Voice.');
        else { try { const channel = await this.eligibleVoice({ guild: newState.guild }, newState.channelId, settings); session.voiceChannelId = channel.id; session.voiceChannelName = channel.name; } catch { this.interrupt(runtime, 'SCRT переміщено до недозволеного каналу.'); } }
        await this.save(runtime, previous, [], 'session.voice_changed', null); return;
      }
      if (oldState.channelId !== session.voiceChannelId && newState.channelId !== session.voiceChannelId) return;
      const listeners = this.listeners(newState.guild, session);
      for (const voter of runtime.votes) if (!listeners.includes(voter)) runtime.votes.delete(voter);
      if (listeners.length === 0 && session.currentTrack && !runtime.emptyTimer) {
        if (settings.emptyVoiceBehavior === 'pause_then_leave') { if (session.state === 'playing') { runtime.engine.pause(); session.state = 'paused'; session.pausedAt = Date.now(); runtime.emptyPaused = true; } }
        else { runtime.engine.stop(); if (session.currentTrack) session.queue.unshift(session.currentTrack); session.currentTrack = null; session.state = 'idle'; session.recoverable = session.queue.length > 0; session.startedAt = null; session.pausedAt = null; session.accumulatedPauseMs = 0; session.playbackOffsetMs = 0; session.queueVersion++; session.lastError = 'Voice порожній. Відтворення зупинено, чергу збережено.'; }
        runtime.emptyTimer = setTimeout(() => { void this.exclusive(session.guildId, async () => { runtime.emptyTimer = null; if (!this.listeners(newState.guild, runtime.session).length) { const prior = session.revision; this.interrupt(runtime, 'Голосовий канал порожній. Чергу збережено.'); await this.save(runtime, prior, [], 'session.empty', null); } }).catch((error: unknown) => this.failClosed(session.guildId, error)); }, settings.emptyVoiceGraceSeconds * 1000);
      } else if (listeners.length && runtime.emptyTimer) {
        clearTimeout(runtime.emptyTimer); runtime.emptyTimer = null;
        if (settings.resumeOnRejoin && runtime.emptyPaused && session.state === 'paused') { runtime.engine.resume(); session.state = 'playing'; session.accumulatedPauseMs += Date.now() - (session.pausedAt ?? Date.now()); session.pausedAt = null; }
        runtime.emptyPaused = false;
      }
      const history: MediaHistoryItem[] = [];
      if (session.currentTrack && runtime.votes.size && countedVotes(runtime.votes, listeners) >= voteThreshold(listeners, settings.skipVoteRatio) && listeners.length) { this.finish(runtime, 'skipped', history); await this.advance(runtime, newState.guild, settings, history); }
      if (JSON.stringify(session) !== before || history.length) await this.save(runtime, previous, history, 'voice.listeners_changed', null);
    });
  }
  async interruptGuild(guildId: string, reason: string) { return this.exclusive(guildId, async () => { const runtime = this.runtimes.get(guildId); if (!runtime?.session) return; const previous = runtime.session.revision; this.interrupt(runtime, reason); await this.save(runtime, previous, [], 'session.interrupted', null); }); }
  async channelDeleted(guildId: string, channelId: string) { if (this.runtimes.get(guildId)?.session?.voiceChannelId === channelId) await this.interruptGuild(guildId, 'Голосовий канал видалено. Чергу збережено.'); }
  suspendAudio(guildId: string) { this.runtimes.get(guildId)?.engine.destroy(); }
  async forgetGuild(guildId: string) { await this.interruptGuild(guildId, 'SCRT вилучено з сервера.'); this.runtimes.delete(guildId); }
  private async failClosed(guildId: string, error: unknown) { const runtime = this.runtimes.get(guildId); runtime?.engine.destroy(); if (runtime) { if (runtime.emptyTimer) clearTimeout(runtime.emptyTimer); this.runtimes.delete(guildId); } log('error', 'media', 'operation.failed', { guildId }, error); }
  async shutdown() {
    this.stopping = true;
    for (const runtime of this.runtimes.values()) runtime.engine.destroy();
    await Promise.allSettled([...this.runtimes.keys()].map((guildId) => this.interruptGuild(guildId, 'Відтворення було перервано перезапуском SCRT.')));
  }
}
// Both HTTP and Discord use this boundary; the session service owns all effects.
export class MediaCommandService { constructor(readonly sessions: MediaSessionService) {} execute(command: MediaCommand) { return this.sessions.execute(command); } }
