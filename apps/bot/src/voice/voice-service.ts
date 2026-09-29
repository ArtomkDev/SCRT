import { ChannelType, DiscordAPIError, PermissionFlagsBits, type Client, type Guild, type GuildMember, type VoiceChannel, type VoiceState } from 'discord.js';
import { GuildRepository, VoiceRepository } from '@scrt/database';
import { PermissionService } from '@scrt/permissions';
import { log } from '@scrt/shared';
import { type VoiceCreator, type VoiceRoom, type VoiceSettings } from '@scrt/validation';
import { reconcileRoomPermissions } from './room-permissions';
import { voicePanelRows } from '@scrt/discord';
import { RoomControlService, type RoomAction } from './room-controls';
import { VoiceError } from './voice-errors';
import { voiceRoomName } from './name-input';
import { roomInsertionIndex } from './room-order';
export { VoiceError } from './voice-errors';

const requiredCreatorPermissions = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.Connect] as const;
export class VoiceService {
  private readonly rooms = new Map<string, VoiceRoom>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly ownerTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly controls: RoomControlService;
  private readonly creationTimes = new Map<string, number>();
  private readonly creatorChannels = new Map<string, Set<string>>();
  private readonly creatorWatches = new Map<string, () => void>();
  constructor(private readonly client: Client, private readonly repository: VoiceRepository, private readonly guildRepository: GuildRepository) { this.controls = new RoomControlService(repository); }

  async canManage(member: GuildMember): Promise<boolean> {
    const mappings = await this.guildRepository.roleMappings(member.guild.id);
    const input = { userId: member.id, ownerId: member.guild.ownerId, discordRoleIds: [...member.roles.cache.keys()], mappings, hasManageGuild: member.permissions.has(PermissionFlagsBits.ManageGuild) };
    return new PermissionService().permissionsFor(input).has('voice.manage');
  }

  private key(guildId: string, channelId: string) { return `${guildId}:${channelId}`; }
  private async exclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.locks.set(key, current);
    await prior;
    try { return await task(); } finally { release(); if (this.locks.get(key) === current) this.locks.delete(key); }
  }
  private cancel(timers: Map<string, ReturnType<typeof setTimeout>>, key: string) { const timer = timers.get(key); if (timer) clearTimeout(timer); timers.delete(key); }
  private cachedRoom(guildId: string, channelId: string) { return this.rooms.get(this.key(guildId, channelId)); }
  private setRoom(room: VoiceRoom) { this.rooms.set(this.key(room.guildId, room.channelId), room); }
  private async audit(room: VoiceRoom, action: string, actorId?: string | null, targetUserId?: string | null, source: 'discord' | 'recovery' = 'discord') {
    try { await this.repository.audit({ guildId: room.guildId, creatorId: room.creatorId, channelId: room.channelId, action, actorId, targetUserId, source }); }
    catch (error) { log('error', 'voice', 'audit.failed', { guildId: room.guildId, channelId: room.channelId, action }, error); }
    if (['room.created', 'room.deleted', 'room.user_blocked', 'room.owner_transferred', 'room.owner_auto_transferred'].includes(action)) {
      try {
        const settings = await this.settings(room.guildId);
        const channel = settings.logChannelId ? this.client.guilds.cache.get(room.guildId)?.channels.cache.get(settings.logChannelId) : null;
        const title: Record<string, string> = { 'room.created': 'Кімнату створено', 'room.deleted': 'Кімнату видалено', 'room.user_blocked': 'Учасника заблоковано', 'room.owner_transferred': 'Власника змінено', 'room.owner_auto_transferred': 'Власника змінено автоматично' };
        if (channel?.isTextBased()) await channel.send(`🎧 ${title[action]} · <#${room.channelId}>${actorId ? ` · <@${actorId}>` : ''}${targetUserId ? ` → <@${targetUserId}>` : ''}`);
      } catch (error) { log('warn', 'voice', 'log-channel.failed', { guildId: room.guildId, channelId: room.channelId, action }, error); }
    }
  }
  private channel(guild: Guild, channelId: string): VoiceChannel | null {
    const channel = guild.channels.cache.get(channelId);
    return channel?.type === ChannelType.GuildVoice ? channel : null;
  }
  private humanMembers(channel: VoiceChannel): GuildMember[] { return [...channel.members.values()].filter((member) => !member.user.bot); }
  private async settings(guildId: string): Promise<VoiceSettings> { return this.repository.getSettings(guildId); }

  async recover(guild: Guild): Promise<void> {
    const settings = await this.settings(guild.id);
    const rooms = await this.repository.listRooms(guild.id);
    const creators = await this.repository.listCreators(guild.id);
    this.creatorChannels.set(guild.id, new Set(creators.filter((creator) => creator.enabled).map((creator) => creator.channelId)));
    this.creatorWatches.get(guild.id)?.();
    this.creatorWatches.set(guild.id, this.repository.watchCreators(guild.id, (current) => {
      this.creatorChannels.set(guild.id, new Set(current.filter((creator) => creator.enabled).map((creator) => creator.channelId)));
    }, (error) => log('error', 'voice', 'creator.watch.failed', { guildId: guild.id }, error)));
    for (const creator of creators) if (!this.channel(guild, creator.channelId) && creator.enabled) await this.repository.disableCreator(guild.id, creator.id);
    let removed = 0;
    let failed = 0;
    for (const room of rooms) {
      try {
        const channel = this.channel(guild, room.channelId);
        if (!channel) { await this.repository.deleteRoom(guild.id, room.channelId); removed++; continue; }
        const recovered = { ...room, state: 'active' as const, memberCount: this.humanMembers(channel).length, updatedAt: Date.now() };
        this.setRoom(recovered);
        if (recovered.memberCount !== room.memberCount || room.state !== 'active') await this.repository.saveRoom(recovered);
        if (recovered.memberCount === 0) this.scheduleCleanup(guild, recovered, settings);
        else if (recovered.ownerId && !channel.members.has(recovered.ownerId) && settings.ownerExitBehavior !== 'keep_owner') this.scheduleOwnerExit(guild, recovered, settings);
        const creator = await this.repository.getCreator(guild.id, room.creatorId);
        if (creator) await reconcileRoomPermissions(guild, channel, creator, settings, recovered);
      } catch (error) {
        failed++;
        log('error', 'voice', 'recovery.room.failed', { guildId: guild.id, channelId: room.channelId }, error);
      }
    }
    log('info', 'voice', 'recovery.complete', { guildId: guild.id, rooms: rooms.length, removed, failed });
    await this.repository.audit({ guildId: guild.id, action: 'voice.recovery', source: 'recovery' });
  }

  async onVoiceState(oldState: VoiceState, newState: VoiceState): Promise<void> {
    if (oldState.channelId === newState.channelId) return;
    const guild = newState.guild;
    const actor = newState.member;
    if (oldState.channelId) await this.refreshOccupancy(guild, oldState.channelId);
    if (newState.channelId) await this.refreshOccupancy(guild, newState.channelId);
    if (!actor || actor.user.bot || !newState.channelId) return;
    if (this.cachedRoom(guild.id, newState.channelId)) return;
    if (!this.creatorChannels.get(guild.id)?.has(newState.channelId)) return;
    const settings = await this.settings(guild.id);
    if (!settings.enabled) return;
    const creator = await this.repository.getCreator(guild.id, newState.channelId);
    if (!creator?.enabled) return;
    const key = `${guild.id}:${actor.id}:create`;
    await this.exclusive(key, () => this.exclusive(`${guild.id}:${creator.id}:room-order`, () => this.createFromCreator(guild, actor, creator)));
  }
  stopGuild(guildId: string) {
    this.creatorWatches.get(guildId)?.();
    this.creatorWatches.delete(guildId);
    this.creatorChannels.delete(guildId);
    for (const key of this.cleanupTimers.keys()) if (key.startsWith(`${guildId}:`)) this.cancel(this.cleanupTimers, key);
    for (const key of this.ownerTimers.keys()) if (key.startsWith(`${guildId}:`)) this.cancel(this.ownerTimers, key);
    for (const key of this.rooms.keys()) if (key.startsWith(`${guildId}:`)) this.rooms.delete(key);
  }
  stop() { for (const guildId of this.creatorWatches.keys()) this.stopGuild(guildId); }

  private async placeRoom(guild: Guild, channel: VoiceChannel, creator: VoiceCreator, source: VoiceChannel) {
    if (creator.roomPlacement === 'bottom' && creator.roomOrder === 'oldest_first') return;
    const siblings: { id: string; position: number }[] = [];
    for (const sibling of guild.channels.cache.values()) {
      if ((sibling.type === ChannelType.GuildVoice || sibling.type === ChannelType.GuildStageVoice) && sibling.parentId === channel.parentId) {
        siblings.push({ id: sibling.id, position: sibling.position });
      }
    }
    siblings.sort((a, b) => a.position - b.position);
    const sameCategory = source.parentId === channel.parentId;
    const activeRoomIds = new Set([...this.rooms.values()]
      .filter((room) => room.guildId === guild.id && room.creatorId === creator.id && room.state === 'active')
      .map((room) => room.channelId));
    const currentIndex = siblings.findIndex((sibling) => sibling.id === channel.id);
    const targetIndex = roomInsertionIndex(siblings.map((sibling) => sibling.id), channel.id, sameCategory ? source.id : null, activeRoomIds, creator);
    if (targetIndex < 0) throw new VoiceError('Не вдалося визначити місце нової кімнати. Спробуйте ще раз.');
    if (targetIndex === currentIndex) return;
    try { await channel.setPosition(targetIndex, { reason: 'SCRT temporary room placement' }); }
    catch (error) {
      log('error', 'voice', 'room.position.failed', { guildId: guild.id, creatorId: creator.id, channelId: channel.id, targetIndex }, error);
      throw new VoiceError('Discord не дозволив розмістити нову кімнату. Перевірте право SCRT «Керувати каналами».');
    }
  }

  private async createFromCreator(guild: Guild, actor: GuildMember, creator: VoiceCreator) {
    if (actor.voice.channelId !== creator.channelId) return;
    const freshSettings = await this.settings(guild.id);
    const freshCreator = await this.repository.getCreator(guild.id, creator.id);
    if (!freshSettings.enabled || !freshCreator?.enabled) return;
    creator = freshCreator;
    const source = this.channel(guild, creator.channelId);
    if (!source) { await this.repository.disableCreator(guild.id, creator.id); return; }
    const parentId = creator.targetCategoryId ?? source.parentId;
    if (creator.targetCategoryId && guild.channels.cache.get(creator.targetCategoryId)?.type !== ChannelType.GuildCategory) throw new VoiceError('Категорію кімнат не знайдено.');
    const me = guild.members.me ?? await guild.members.fetchMe();
    const permissions = source.permissionsFor(me);
    if (!permissions || requiredCreatorPermissions.some((permission) => !permissions.has(permission))) throw new VoiceError('SCRT бракує дозволів для створення голосової кімнати.');
    const category = parentId ? guild.channels.cache.get(parentId) : null;
    const categoryPermissions = category && 'permissionsFor' in category ? category.permissionsFor(me) : null;
    if (category && (!categoryPermissions || [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.Connect].some((permission) => !categoryPermissions.has(permission)))) throw new VoiceError('SCRT бракує дозволів у категорії кімнат.');
    const existing = [...this.rooms.values()].filter((room) => room.guildId === guild.id && room.ownerId === actor.id && room.state === 'active' && this.channel(guild, room.channelId));
    if (freshSettings.duplicateRoomPolicy === 'reuse' && existing.length) { await actor.voice.setChannel(existing[0]!.channelId); return; }
    if (existing.length >= freshSettings.maxRoomsPerUser) throw new VoiceError('Досягнуто ліміту ваших кімнат.');
    const creationKey = `${guild.id}:${actor.id}`;
    if (Date.now() - (this.creationTimes.get(creationKey) ?? 0) < 10_000) throw new VoiceError('Зачекайте перед створенням нової кімнати.');
    this.creationTimes.set(creationKey, Date.now());
    if (this.creationTimes.size > 5000) this.creationTimes.delete(this.creationTimes.keys().next().value!);
    const counter = existing.length + 1;
    const name = voiceRoomName(actor, creator, counter, category?.name);
    let channel: VoiceChannel;
    try { channel = await guild.channels.create({ name, type: ChannelType.GuildVoice, parent: parentId ?? undefined, userLimit: creator.defaultUserLimit, bitrate: Math.min(creator.defaultBitrate ?? 64000, guild.maximumBitrate), rtcRegion: creator.defaultRtcRegion ?? undefined }); }
    catch (error) { if (error instanceof DiscordAPIError && error.code === 50013) throw new VoiceError('SCRT бракує дозволів для створення кімнати.'); throw error; }
    const now = Date.now();
    const room: VoiceRoom = { guildId: guild.id, channelId: channel.id, creatorId: creator.id, ownerId: actor.id, state: 'creating', locked: creator.defaultLocked, hidden: creator.defaultHidden, chatClosed: creator.defaultChatClosed, permittedUserIds: [], blockedUserIds: [], memberCount: 0, ownerLeftAt: null, createdAt: now, updatedAt: now, lastActivityAt: now, nameCounter: counter, schemaVersion: 1 };
    try {
      await this.placeRoom(guild, channel, creator, source);
      await this.repository.saveRoom(room);
      try {
        await reconcileRoomPermissions(guild, channel, creator, freshSettings, room);
      } catch (error) {
        if (error instanceof DiscordAPIError && error.code === 50013) {
          log('error', 'voice', 'room.permissions.denied', { guildId: guild.id, creatorId: creator.id, channelId: channel.id }, error);
          throw new VoiceError('Discord відхилив зміну дозволів нової кімнати. Перевірте дозволи категорії; деталі помилки записано в консоль бота.');
        }
        throw error;
      }
      if (actor.voice.channelId !== creator.channelId) throw new VoiceError('Ви залишили канал створення.');
      try {
        await actor.voice.setChannel(channel);
      } catch (error) {
        if (error instanceof DiscordAPIError && error.code === 50013) {
          log('error', 'voice', 'room.move.denied', { guildId: guild.id, creatorId: creator.id, channelId: channel.id, userId: actor.id }, error);
          throw new VoiceError('Discord заборонив SCRT перемістити вас до кімнати. Перевірте право «Переміщувати учасників» у Creator-каналі та доступ до нової кімнати.');
        }
        throw error;
      }
      const active = { ...room, state: 'active' as const, memberCount: 1, updatedAt: Date.now() };
      await this.repository.saveRoom(active);
      this.setRoom(active);
      const mode = creator.interfaceMode === 'inherit' ? freshSettings.defaultInterfaceMode : creator.interfaceMode;
      if (mode === 'room' || mode === 'both') {
        try { await channel.send({ content: 'Керування кімнатою · використовуйте кнопки або /voice', components: voicePanelRows() }); }
        catch (failure) { log('warn', 'voice', 'greeting.failed', { guildId: guild.id, channelId: channel.id }, failure); }
      }
      await this.audit(active, 'room.created', actor.id);
    } catch (error) {
      if (channel.members.size === 0) {
        await channel.delete('SCRT voice creation rollback').catch((failure: unknown) => log('error', 'voice', 'rollback.channel.failed', { guildId: guild.id, channelId: channel.id }, failure));
        await this.repository.deleteRoom(guild.id, channel.id).catch((failure: unknown) => log('error', 'voice', 'rollback.record.failed', { guildId: guild.id, channelId: channel.id }, failure));
      }
      throw error;
    }
  }

  private async refreshOccupancy(guild: Guild, channelId: string) {
    let room = this.cachedRoom(guild.id, channelId);
    if (!room) return;
    const channel = this.channel(guild, channelId);
    if (!channel) return;
    const memberCount = this.humanMembers(channel).length;
    if (memberCount !== room.memberCount) {
      const next = { ...room, memberCount, lastActivityAt: Date.now(), updatedAt: Date.now() };
      this.setRoom(next);
      await this.repository.saveRoom(next);
      room = next;
    }
    const settings = await this.settings(guild.id);
    if (memberCount === 0) this.scheduleCleanup(guild, room, settings);
    else this.cancel(this.cleanupTimers, this.key(guild.id, channelId));
    if (room.ownerId && channel.members.has(room.ownerId)) {
      this.cancel(this.ownerTimers, this.key(guild.id, channelId));
      if (room.ownerLeftAt !== null) {
        const next = { ...room, ownerLeftAt: null, updatedAt: Date.now() };
        this.setRoom(next);
        await this.repository.updateRoom(guild.id, channelId, { ownerLeftAt: null });
      }
    }
    else if (room.ownerId && settings.ownerExitBehavior !== 'keep_owner') this.scheduleOwnerExit(guild, room, settings);
  }

  private scheduleCleanup(guild: Guild, room: VoiceRoom, settings: VoiceSettings) {
    const key = this.key(guild.id, room.channelId);
    this.cancel(this.cleanupTimers, key);
    const remaining = Math.max(0, room.lastActivityAt + settings.cleanupDelaySeconds * 1000 - Date.now());
    this.cleanupTimers.set(key, setTimeout(() => { void this.deleteIfEmpty(guild, room.channelId).catch((error: unknown) => log('error', 'voice', 'cleanup.failed', { guildId: guild.id, channelId: room.channelId }, error)); }, remaining));
  }
  private async deleteIfEmpty(guild: Guild, channelId: string) {
    await this.exclusive(this.key(guild.id, channelId), async () => {
      const room = this.cachedRoom(guild.id, channelId);
      if (!room) return;
      const channel = this.channel(guild, channelId);
      if (channel && this.humanMembers(channel).length) return;
      await this.deleteRoom(guild, room, channel);
    });
  }
  private async deleteRoom(guild: Guild, room: VoiceRoom, channel: VoiceChannel | null) {
    const key = this.key(guild.id, room.channelId);
    this.cancel(this.cleanupTimers, key);
    this.cancel(this.ownerTimers, key);
    this.setRoom({ ...room, state: 'deleting' });
    try {
      await this.repository.updateRoom(guild.id, room.channelId, { state: 'deleting' });
      if (channel) await channel.delete('SCRT temporary voice room cleanup');
      await this.repository.deleteRoom(guild.id, room.channelId);
      this.rooms.delete(key);
      await this.audit(room, 'room.deleted');
    } catch (error) {
      this.setRoom(room);
      await this.repository.updateRoom(guild.id, room.channelId, { state: 'active' }).catch(() => undefined);
      throw error;
    }
  }
  private scheduleOwnerExit(guild: Guild, room: VoiceRoom, settings: VoiceSettings) {
    const key = this.key(guild.id, room.channelId);
    if (this.ownerTimers.has(key)) return;
    const leftAt = room.ownerLeftAt ?? Date.now();
    if (!room.ownerLeftAt) { const next = { ...room, ownerLeftAt: leftAt }; this.setRoom(next); void this.repository.updateRoom(guild.id, room.channelId, { ownerLeftAt: leftAt }).catch((error: unknown) => log('error', 'voice', 'owner.timestamp.failed', { guildId: guild.id, channelId: room.channelId }, error)); }
    const remaining = Math.max(0, leftAt + settings.ownerLeaveGraceSeconds * 1000 - Date.now());
    this.ownerTimers.set(key, setTimeout(() => { void this.resolveOwnerExit(guild, room.channelId).catch((error: unknown) => log('error', 'voice', 'owner.exit.failed', { guildId: guild.id, channelId: room.channelId }, error)); }, remaining));
  }
  private async resolveOwnerExit(guild: Guild, channelId: string) {
    await this.exclusive(this.key(guild.id, channelId), async () => {
      this.ownerTimers.delete(this.key(guild.id, channelId));
      const room = this.cachedRoom(guild.id, channelId);
      const channel = this.channel(guild, channelId);
      if (!room?.ownerId || !channel || channel.members.has(room.ownerId)) return;
      const settings = await this.settings(guild.id);
      if (settings.ownerExitBehavior === 'keep_owner') return;
      const nextOwner = settings.ownerExitBehavior === 'auto_transfer' ? this.humanMembers(channel).filter((member) => !room.blockedUserIds.includes(member.id)).sort((a, b) => a.id.localeCompare(b.id))[0]?.id ?? null : null;
      if (!await this.repository.changeOwner(guild.id, channelId, room.ownerId, nextOwner)) return;
      const next = { ...room, ownerId: nextOwner, ownerLeftAt: null, updatedAt: Date.now() };
      this.setRoom(next);
      const creator = await this.repository.getCreator(guild.id, room.creatorId);
      if (creator) await reconcileRoomPermissions(guild, channel, creator, settings, next);
      await this.audit(next, nextOwner ? 'room.owner_auto_transferred' : 'room.owner_released', null, nextOwner);
    });
  }
  async onChannelDelete(guild: Guild, channelId: string) {
    const room = this.cachedRoom(guild.id, channelId);
    if (room && room.state !== 'deleting') {
      const key = this.key(guild.id, channelId);
      this.cancel(this.cleanupTimers, key); this.cancel(this.ownerTimers, key);
      this.rooms.delete(key);
      await this.repository.deleteRoom(guild.id, channelId);
      await this.audit(room, 'room.deleted');
    }
    const creator = await this.repository.getCreator(guild.id, channelId);
    if (creator) await this.repository.disableCreator(guild.id, channelId);
  }

  roomForMember(member: GuildMember): VoiceRoom | null {
    const channelId = member.voice.channelId;
    return channelId ? this.cachedRoom(member.guild.id, channelId) ?? null : null;
  }
  async canUsePanel(member: GuildMember, panelChannelId: string, messageId: string, ephemeral: boolean): Promise<boolean> {
    const room = this.roomForMember(member);
    if (!room) return false;
    if (ephemeral || panelChannelId === room.channelId) return true;
    const interfaces = await this.repository.listInterfaces(room.guildId);
    return interfaces.some((item) => item.enabled && item.channelId === panelChannelId && item.messageId === messageId && (item.creatorIds === null || item.creatorIds.includes(room.creatorId)));
  }
  async act(input: { member: GuildMember; action: RoomAction; value?: string | number; target?: GuildMember; admin?: boolean }): Promise<string> {
    const room = this.roomForMember(input.member);
    if (!room) throw new VoiceError('Зайдіть у свою тимчасову кімнату.');
    const key = this.key(room.guildId, room.channelId);
    return this.exclusive(key, async () => {
      const current = this.cachedRoom(room.guildId, room.channelId);
      const channel = this.channel(input.member.guild, room.channelId);
      if (!current || !channel) throw new VoiceError('Кімнату більше не знайдено.');
      const [creator, settings] = await Promise.all([this.repository.getCreator(room.guildId, room.creatorId), this.settings(room.guildId)]);
      if (!creator || !settings.enabled) throw new VoiceError('Налаштування кімнати недоступні.');
      return this.controls.execute({
        ...input, admin: input.admin ?? false, room: current, channel, creator, settings,
        cache: (next) => this.setRoom(next),
        audit: (next, action, targetUserId) => this.audit(next, action, input.member.id, targetUserId),
        remove: () => this.deleteRoom(input.member.guild, current, channel),
        cancelOwnerGrace: () => this.cancel(this.ownerTimers, key),
        canManage: (target) => this.canManage(target),
      });
    });
  }
}
