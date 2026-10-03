import { ActivityType, type Client, type Guild, type GuildMember, type Message, type Presence, type VoiceState } from 'discord.js';
import { ActivityRepository, type ActivityHealth } from '@scrt/database';
import { activityDate, log, normalizeGame } from '@scrt/shared';
import { activitySettingsSchema, type ActivitySettings } from '@scrt/validation';
import { activityEligible, type ActivityChannel } from './eligibility';
import { MessageActivityBuffer } from './message-buffer';
import { ActivitySessionService } from './session-service';
import { gameSessions, voiceSessions } from './trackers';
import type { ActivityArtworkResolver } from '@scrt/artwork';
import { discordActivityArtwork } from './artwork';

export class ActivityModule {
  private readonly settings = new Map<string, ActivitySettings>();
  private readonly watches = new Map<string, () => void>();
  private readonly profiles = new Map<string, number>();
  private readonly profileWrites = new Map<string, Promise<void>>();
  private readonly recovering = new Map<string, Promise<void>>();
  private readonly suspending = new Map<string, Promise<void>>();
  private readonly messageIds = new Map<string, number>();
  private readonly artworkRequests = new Map<string, { at: number; signature: string }>();
  private readonly sessions: ActivitySessionService;
  readonly messages: MessageActivityBuffer;
  private readonly recoveryHealth = new Map<string, boolean>();
  private aggregation = false;
  private connected = false;
  private stopping = false;
  private ticking = false;
  private disconnecting: Promise<void> | null = null;
  private readonly messageTimer: NodeJS.Timeout;
  private readonly reconcileTimer: NodeJS.Timeout;
  constructor(private readonly client: Client, private readonly repository: ActivityRepository, private readonly presenceAvailable: boolean, private readonly artwork?: ActivityArtworkResolver) {
    this.sessions = new ActivitySessionService(repository);
    this.messages = new MessageActivityBuffer((guildId, token, values) => repository.flushMessages(guildId, token, values));
    this.messageTimer = setInterval(() => { void this.flush().catch((error: unknown) => log('error', 'activity', 'message.flush.failed', {}, error)); }, 60_000);
    this.reconcileTimer = setInterval(() => { void this.tick().catch((error: unknown) => log('error', 'activity', 'reconcile.failed', {}, error)); }, 300_000);
  }
  private config(guildId: string) { return this.settings.get(guildId) ?? activitySettingsSchema.parse({}); }
  private channel(guild: Guild, channelId: string | null): ActivityChannel | null {
    const channel = channelId ? guild.channels.cache.get(channelId) : null;
    if (!channel) return null;
    const parent = channel.parentId ? guild.channels.cache.get(channel.parentId) : null;
    if (channel.isThread() && !parent && this.config(guild.id).exclusions.categoryIds.length) return null;
    return { id: channel.id, parentId: channel.parentId, categoryId: channel.isThread() ? parent?.parentId ?? null : channel.parentId, afk: channel.id === guild.afkChannelId };
  }
  private async profile(member: GuildMember) {
    const key = `${member.guild.id}:${member.id}`;
    if ((this.profiles.get(key) ?? 0) > Date.now() - 120_000) return;
    const prior = this.profileWrites.get(key);
    if (prior) return prior;
    if (this.profileWrites.size >= 2000) throw new Error('Activity profile writer is busy');
    const pending = this.repository.saveProfile(member.guild.id, { userId: member.id, displayName: member.displayName, username: member.user.username, avatarUrl: member.displayAvatarURL({ extension: 'webp', size: 64 }), searchName: member.displayName.toLocaleLowerCase('uk-UA'), updatedAt: Date.now() }).then(() => {
      this.profiles.set(key, Date.now());
      if (this.profiles.size > 2000) this.profiles.delete(this.profiles.keys().next().value!);
    }).finally(() => { this.profileWrites.delete(key); });
    this.profileWrites.set(key, pending);
    return pending;
  }
  async onMessage(message: Message): Promise<void> {
    if (this.stopping || !this.connected || !message.guild || message.guild.available === false || message.author.bot || message.webhookId) return;
    const settings = this.config(message.guild.id);
    if (!settings.enabled || !settings.tracking.messages) return;
    if (this.messageIds.has(message.id)) return;
    const actor = { userId: message.author.id, bot: message.author.bot, roleIds: message.member ? [...message.member.roles.cache.keys()] : null };
    if (!activityEligible(settings, 'messages', actor, this.channel(message.guild, message.channelId))) return;
    this.messages.add(message.guild.id, message.author.id, activityDate(message.createdTimestamp, settings.streak.timezone), message.createdTimestamp);
    this.messageIds.set(message.id, Date.now());
    while (this.messageIds.size > 10000) this.messageIds.delete(this.messageIds.keys().next().value!);
    if (message.member) void this.profile(message.member).catch((error: unknown) => log('warn', 'activity', 'profile.failed', { guildId: message.guildId, userId: message.author.id }, error));
    if (this.messages.size >= 1000) await this.flush();
  }
  async onVoiceState(_before: VoiceState, after: VoiceState): Promise<void> {
    if (this.stopping || !this.connected || !this.recoveryHealth.get(after.guild.id)) return;
    await this.reconcileMember(after.guild, after.id, Date.now(), after.member ?? undefined, false, after);
  }
  async onPresence(presence: Presence): Promise<void> {
    if (this.stopping || !this.connected || !this.presenceAvailable || !presence.guild || !this.recoveryHealth.get(presence.guild.id)) return;
    await this.reconcileMember(presence.guild, presence.userId, Date.now(), presence.member ?? undefined, false, undefined, presence);
  }
  private async reconcileMember(guild: Guild, userId: string, now: number, observedMember?: GuildMember, refreshRoles = false, observedVoice?: VoiceState, observedPresence?: Presence) {
    const voice = observedVoice ?? guild.voiceStates.cache.get(userId);
    const state = voice ? { channelId: voice.channelId, streaming: voice.streaming } : undefined;
    const presence = observedPresence ?? guild.presences.cache.get(userId);
    const games = presence ? { status: presence.status, activities: presence.activities.map((activity) => ({ type: activity.type, name: activity.name, applicationId: activity.applicationId })) } : undefined;
    const channel = this.channel(guild, state?.channelId ?? null);
    const eventRoles = observedMember ? [...observedMember.roles.cache.keys()] : null;
    const config = this.config(guild.id);
    const hasSession = this.sessions.sessions(guild.id).some((session) => session.userId === userId);
    if (!hasSession && (!config.enabled || !state?.channelId && (!this.presenceAvailable || !config.tracking.games || !games?.activities.some((game) => game.type === ActivityType.Playing)))) return;
    await this.sessions.exclusive(guild.id, userId, async () => {
      const settings = this.config(guild.id);
      const hasSession = this.sessions.sessions(guild.id).some((session) => session.userId === userId);
      if (!settings.enabled && !hasSession) return;
      let member = observedMember ?? guild.members.cache.get(userId);
      if ((!member || refreshRoles && settings.exclusions.roleIds.length > 0) && settings.enabled) {
        try { member = await guild.members.fetch({ user: userId, force: true }); }
        catch (error) { log('warn', 'activity', 'member.unavailable', { guildId: guild.id, userId }, error); member = undefined; }
      }
      const actor = { userId, bot: member?.user.bot ?? true, roleIds: eventRoles ?? (member ? [...member.roles.cache.keys()] : null) };
      const desired = this.connected ? [...voiceSessions(state, settings, actor, channel), ...gameSessions(games, settings, actor, this.presenceAvailable)] : [];
      await this.sessions.reconcile(guild.id, userId, desired, settings, now);
      // Sessions are authoritative. Artwork starts after persistence and is never awaited here.
      for (const session of desired) if (session.game && this.artwork) {
        const activity = presence?.activities.find((item) => item.type === ActivityType.Playing && normalizeGame(item.name, item.applicationId)?.gameKey === session.game!.gameKey);
        const discord = activity ? discordActivityArtwork(activity) : undefined;
        const key = `${guild.id}:${session.game.gameKey}`;
        const signature = JSON.stringify(discord);
        const prior = this.artworkRequests.get(key);
        if (prior && prior.at > now - 3600_000 && prior.signature === signature) continue;
        this.artworkRequests.set(key, { at: now, signature });
        if (this.artworkRequests.size > 2000) this.artworkRequests.delete(this.artworkRequests.keys().next().value!);
        void this.artwork.resolve(guild.id, session.game, { discord }).catch(() => {
          this.artworkRequests.delete(key);
          log('warn', 'activity-artwork', 'enrichment.failed', { guildId: guild.id, gameKey: session.game!.gameKey });
        });
      }
      if (desired.length && member) void this.profile(member).catch((error: unknown) => log('warn', 'activity', 'profile.failed', { guildId: guild.id, userId }, error));
    });
  }
  private async reconcileGuild(guild: Guild, discoverGames = false, duringRecovery = false) {
    if (this.stopping || !this.connected || guild.available === false || !duringRecovery && !this.recoveryHealth.get(guild.id)) return;
    const config = this.config(guild.id);
    const gameUsers = discoverGames && this.presenceAvailable && config.enabled && config.tracking.games ? [...guild.presences.cache.values()].filter((presence) => presence.status !== 'offline' && presence.activities.some((game) => game.type === ActivityType.Playing)).map((presence) => presence.userId) : [];
    const users = new Set([...guild.voiceStates.cache.values()].filter((voice) => voice.channelId).map((voice) => voice.id).concat(this.sessions.sessions(guild.id).map((session) => session.userId), gameUsers));
    for (const userId of users) {
      if (this.stopping || !this.connected || !duringRecovery && !this.recoveryHealth.get(guild.id)) return;
      await this.reconcileMember(guild, userId, Date.now(), undefined, true);
    }
  }
  async recover(guild: Guild): Promise<void> {
    if (this.stopping || guild.available === false) return;
    await this.disconnecting;
    await this.suspending.get(guild.id);
    const prior = this.recovering.get(guild.id);
    if (prior) return prior;
    const recovery = this.recoverGuild(guild).finally(() => { this.recovering.delete(guild.id); });
    this.recovering.set(guild.id, recovery);
    return recovery;
  }
  private async recoverGuild(guild: Guild) {
    this.recoveryHealth.set(guild.id, false);
    this.watches.get(guild.id)?.();
    this.watches.delete(guild.id);
    this.settings.set(guild.id, await this.repository.getSettings(guild.id));
    this.watches.set(guild.id, this.repository.watchSettings(guild.id, (next) => {
      if (this.stopping) return;
      const previous = this.settings.get(guild.id);
      this.settings.set(guild.id, next);
      if (JSON.stringify(previous) !== JSON.stringify(next)) log('info', 'activity', 'config.updated', { guildId: guild.id, enabled: next.enabled, ...next.tracking });
      if (this.connected && JSON.stringify(previous) !== JSON.stringify(next)) {
        const reconciliation = this.recoveryHealth.get(guild.id) ? this.reconcileGuild(guild, true) : this.recover(guild);
        void reconciliation.then(() => this.publishHealth(guild.id)).catch((error: unknown) => log('error', 'activity', 'config.reconcile.failed', { guildId: guild.id }, error));
      }
    }, (error) => { this.settings.set(guild.id, activitySettingsSchema.parse({})); this.recoveryHealth.set(guild.id, false); log('error', 'activity', 'config.watch.failed', { guildId: guild.id }, error); }));
    await this.sessions.drain(guild.id);
    await this.sessions.recover(guild.id);
    await this.reconcileGuild(guild, true, true);
    if (this.stopping || guild.available === false) return;
    this.recoveryHealth.set(guild.id, true);
    await this.publishHealth(guild.id);
    const settings = this.config(guild.id);
    log('info', 'activity', 'recovery.complete', { guildId: guild.id, enabled: settings.enabled, ...settings.tracking, presenceAvailable: this.presenceAvailable, sessions: this.sessions.sessions(guild.id).length });
  }
  setConnected(value: boolean) { this.connected = value; }
  suspendGuild(guildId: string): Promise<void> {
    this.recoveryHealth.set(guildId, false);
    const prior = this.suspending.get(guildId);
    if (prior) return prior;
    const recovering = this.recovering.get(guildId);
    const suspension = (async () => {
      await recovering?.catch(() => undefined);
      this.recoveryHealth.set(guildId, false);
      await this.sessions.drain(guildId);
      await this.sessions.suspend(guildId);
      await this.publishHealth(guildId);
    })().finally(() => { this.suspending.delete(guildId); });
    this.suspending.set(guildId, suspension);
    return suspension;
  }
  disconnect(): Promise<void> {
    this.connected = false;
    this.recoveryHealth.forEach((_value, key) => this.recoveryHealth.set(key, false));
    if (this.disconnecting) return this.disconnecting;
    this.disconnecting = this.suspendSessions().finally(() => { this.disconnecting = null; });
    return this.disconnecting;
  }
  private async suspendSessions() {
    await this.sessions.drain();
    for (const guild of this.client.guilds.cache.values()) {
      // Only settle the last observed boundary when the Gateway stops providing evidence.
      await this.sessions.suspend(guild.id);
      await this.publishHealth(guild.id);
    }
  }
  private async flush() { try { await this.messages.flush(); this.aggregation = true; } catch (error) { this.aggregation = false; throw error; } }
  private async tick() {
    if (this.stopping || this.ticking || !this.connected) return;
    this.ticking = true;
    try {
      for (const guild of this.client.guilds.cache.values()) {
        if (guild.available === false) continue;
        try {
          if (!this.recoveryHealth.get(guild.id)) await this.recover(guild);
          await this.reconcileGuild(guild);
          if (!this.connected || this.stopping) return;
          await this.sessions.checkpoint(guild.id, Date.now());
          await this.repository.cleanupReceipts(guild.id);
        } catch (error) { this.aggregation = false; log('error', 'activity', 'guild.reconcile.failed', { guildId: guild.id }, error); }
        try { await this.publishHealth(guild.id); }
        catch (error) { log('error', 'activity', 'health.publish.failed', { guildId: guild.id }, error); }
      }
    } finally { this.ticking = false; }
  }
  private async publishHealth(guildId: string) {
    const active = this.sessions.sessions(guildId);
    const health: ActivityHealth = { observedAt: Date.now(), connected: this.connected && !this.stopping && this.client.guilds.cache.get(guildId)?.available !== false, presence: this.presenceAvailable, aggregation: this.aggregation, recovery: this.recoveryHealth.get(guildId) ?? false, activeVoice: active.filter((session) => session.tracker === 'voice').length, activeStream: active.filter((session) => session.tracker === 'stream').length, activeGames: active.filter((session) => session.tracker === 'game').length };
    await this.repository.saveHealth(guildId, health);
  }
  async stopGuild(guildId: string) {
    this.watches.get(guildId)?.(); this.watches.delete(guildId);
    this.settings.set(guildId, activitySettingsSchema.parse({}));
    for (const session of this.sessions.sessions(guildId)) await this.sessions.exclusive(guildId, session.userId, () => this.sessions.reconcile(guildId, session.userId, [], this.config(guildId), Date.now()));
    await this.publishHealth(guildId);
    this.settings.delete(guildId); this.recoveryHealth.delete(guildId);
  }
  async shutdown(): Promise<void> {
    this.stopping = true;
    clearInterval(this.messageTimer); clearInterval(this.reconcileTimer);
    this.watches.forEach((stop) => stop()); this.watches.clear();
    await Promise.allSettled([...this.recovering.values(), ...this.suspending.values(), ...(this.disconnecting ? [this.disconnecting] : [])]);
    await this.sessions.drain();
    await Promise.allSettled([...this.profileWrites.values()]);
    const finalFlush = async () => { do { await this.flush(); } while (this.messages.size > 0); };
    const results: PromiseSettledResult<void>[] = [await finalFlush().then(() => ({ status: 'fulfilled' as const, value: undefined }), (reason: unknown) => ({ status: 'rejected' as const, reason }))];
    for (const guild of this.client.guilds.cache.values()) {
      results.push(...await Promise.allSettled([this.sessions.checkpoint(guild.id, Date.now()), this.publishHealth(guild.id)]));
    }
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map((failure) => failure.reason), 'Activity shutdown operations failed');
  }
}
