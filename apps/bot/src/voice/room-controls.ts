import type { GuildMember, VoiceChannel } from 'discord.js';
import type { VoiceRepository } from '@scrt/database';
import { type VoiceCreator, type VoiceRoom, type VoiceSettings } from '@scrt/validation';
import { reconcileRoomPermissions } from './room-permissions';
import { VoiceError } from './voice-errors';
import { voiceRoomName } from './name-input';

export type RoomAction = 'lock' | 'unlock' | 'hide' | 'show' | 'chatOpen' | 'chatClose' | 'rename' | 'limit' | 'bitrate' | 'region' | 'permit' | 'block' | 'unblock' | 'kick' | 'transfer' | 'claim' | 'reset' | 'delete';
const featureForAction: Partial<Record<RoomAction, keyof VoiceCreator['enabledFeatures']>> = { lock: 'lock', unlock: 'lock', hide: 'hide', show: 'hide', chatOpen: 'chat', chatClose: 'chat', rename: 'rename', limit: 'userLimit', bitrate: 'bitrate', region: 'region', permit: 'permit', block: 'block', unblock: 'block', kick: 'kick', transfer: 'transfer', claim: 'claim', reset: 'reset', delete: 'delete' };

type ControlInput = {
  member: GuildMember; action: RoomAction; value?: string | number; target?: GuildMember; admin: boolean;
  room: VoiceRoom; channel: VoiceChannel; creator: VoiceCreator; settings: VoiceSettings;
  cache: (room: VoiceRoom) => void;
  audit: (room: VoiceRoom, action: string, targetUserId?: string | null) => Promise<void>;
  remove: () => Promise<void>;
  cancelOwnerGrace: () => void;
  canManage: (member: GuildMember) => Promise<boolean>;
};

export class RoomControlService {
  private readonly actionTimes = new Map<string, number>();
  constructor(private readonly repository: VoiceRepository) {}

  async execute(input: ControlInput): Promise<string> {
    const { member, action, value, target, admin, room, channel, creator, settings, cache, audit, remove, cancelOwnerGrace, canManage } = input;
    const feature = featureForAction[action];
    if (feature && !creator.enabledFeatures[feature]) throw new VoiceError('Цю дію вимкнено для Creator-каналу.');
    if (action !== 'claim' && room.ownerId !== member.id && !admin) throw new VoiceError('Ви не є власником цієї кімнати.');
    const rateKey = `${room.guildId}:${member.id}`;
    if (Date.now() - (this.actionTimes.get(rateKey) ?? 0) < 1500) throw new VoiceError('Зачекайте перед наступною дією.');
    this.actionTimes.set(rateKey, Date.now());
    if (this.actionTimes.size > 5000) {
      for (const [id, at] of this.actionTimes) if (Date.now() - at > 60_000) this.actionTimes.delete(id);
      while (this.actionTimes.size > 5000) this.actionTimes.delete(this.actionTimes.keys().next().value!);
    }
    const update = async (patch: Partial<VoiceRoom>, event: string) => {
      const next = { ...room, ...patch, updatedAt: Date.now() };
      await reconcileRoomPermissions(member.guild, channel, creator, settings, next);
      await this.repository.saveRoom(next);
      cache(next);
      await audit(next, event, target?.id);
    };
    if (action === 'lock' || action === 'unlock') { await update({ locked: action === 'lock' }, action === 'lock' ? 'room.locked' : 'room.unlocked'); return action === 'lock' ? 'Кімнату закрито.' : 'Кімнату відкрито.'; }
    if (action === 'hide' || action === 'show') { await update({ hidden: action === 'hide' }, action === 'hide' ? 'room.hidden' : 'room.shown'); return action === 'hide' ? 'Кімнату приховано.' : 'Кімнату показано.'; }
    if (action === 'chatOpen' || action === 'chatClose') { await update({ chatClosed: action === 'chatClose' }, 'room.chat_changed'); return action === 'chatClose' ? 'Чат закрито.' : 'Чат відкрито.'; }
    if (action === 'rename') {
      const name = String(value ?? '').replace(/\s+/gu, ' ').trim();
      if (!name || name.length > 100) throw new VoiceError('Назва має містити від 1 до 100 символів.');
      await channel.setName(name); await audit(room, 'room.renamed'); return 'Назву кімнати змінено.';
    }
    if (action === 'limit') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 99) throw new VoiceError('Ліміт має бути від 0 до 99.');
      await channel.setUserLimit(value); await audit(room, 'room.limit_changed'); return 'Ліміт учасників змінено.';
    }
    if (action === 'bitrate') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 8000 || value > member.guild.maximumBitrate) throw new VoiceError('Недоступний бітрейт для цього сервера.');
      await channel.setBitrate(value); await audit(room, 'room.bitrate_changed'); return 'Бітрейт змінено.';
    }
    if (action === 'region') {
      const region = String(value ?? 'auto');
      if (region !== 'auto' && !(await member.client.fetchVoiceRegions()).has(region)) throw new VoiceError('Недоступний голосовий регіон.');
      await channel.setRTCRegion(region === 'auto' ? null : region); await audit(room, 'room.region_changed'); return 'Регіон змінено.';
    }
    if (['permit', 'block', 'unblock', 'kick', 'transfer'].includes(action)) {
      if (!target || target.guild.id !== room.guildId || target.user.bot || target.id === room.ownerId || target.id === member.guild.ownerId) throw new VoiceError('Недопустимий учасник.');
      if (action === 'block' && ([...settings.bypassRoleIds, ...creator.bypassRoleIds].some((id) => target.roles.cache.has(id)) || await canManage(target))) throw new VoiceError('Цього адміністратора або роль обходу не можна заблокувати.');
      if (action === 'permit') { await update({ permittedUserIds: [...new Set([...room.permittedUserIds, target.id])], blockedUserIds: room.blockedUserIds.filter((id) => id !== target.id) }, 'room.user_permitted'); return 'Доступ надано.'; }
      if (action === 'block') { await update({ blockedUserIds: [...new Set([...room.blockedUserIds, target.id])], permittedUserIds: room.permittedUserIds.filter((id) => id !== target.id) }, 'room.user_blocked'); if (target.voice.channelId === room.channelId) await target.voice.disconnect(); return 'Учасника заблоковано.'; }
      if (action === 'unblock') { await update({ blockedUserIds: room.blockedUserIds.filter((id) => id !== target.id) }, 'room.user_unblocked'); return 'Блокування знято.'; }
      if (target.voice.channelId !== room.channelId) throw new VoiceError('Учасник не перебуває в цій кімнаті.');
      if (action === 'kick') { await target.voice.disconnect(); await audit(room, 'room.user_kicked', target.id); return 'Учасника відключено від кімнати.'; }
      if (room.blockedUserIds.includes(target.id)) throw new VoiceError('Заблокований учасник не може стати власником.');
      if (!await this.repository.changeOwner(room.guildId, room.channelId, room.ownerId, target.id)) throw new VoiceError('Власник кімнати вже змінився.');
      const next = { ...room, ownerId: target.id, ownerLeftAt: null, updatedAt: Date.now() };
      cache(next); cancelOwnerGrace();
      await reconcileRoomPermissions(member.guild, channel, creator, settings, next);
      await audit(next, 'room.owner_transferred', target.id);
      return 'Право власності передано.';
    }
    if (action === 'claim') {
      if (room.ownerId || settings.ownerExitBehavior !== 'claimable' || room.blockedUserIds.includes(member.id)) throw new VoiceError('Кімнату зараз не можна забрати.');
      if (!await this.repository.changeOwner(room.guildId, room.channelId, null, member.id)) throw new VoiceError('Кімнату вже забрав інший учасник.');
      const next = { ...room, ownerId: member.id, ownerLeftAt: null, updatedAt: Date.now() };
      cache(next); await reconcileRoomPermissions(member.guild, channel, creator, settings, next);
      await audit(next, 'room.owner_claimed'); return 'Ви стали власником кімнати.';
    }
    if (action === 'reset') {
      const owner = room.ownerId ? await member.guild.members.fetch(room.ownerId).catch(() => null) : null;
      const name = voiceRoomName(owner ?? member, creator, room.nameCounter ?? 1, channel.parent?.name);
      await channel.edit({ name, userLimit: creator.defaultUserLimit, bitrate: Math.min(creator.defaultBitrate ?? 64000, member.guild.maximumBitrate), rtcRegion: creator.defaultRtcRegion });
      await update({ locked: creator.defaultLocked, hidden: creator.defaultHidden, chatClosed: creator.defaultChatClosed, permittedUserIds: [], blockedUserIds: [] }, 'room.reset');
      return 'Налаштування кімнати скинуто.';
    }
    if (action === 'delete') { await remove(); return 'Кімнату видалено.'; }
    throw new VoiceError('Невідома дія.');
  }
}
