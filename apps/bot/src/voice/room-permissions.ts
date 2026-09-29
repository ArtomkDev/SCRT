import { OverwriteType, PermissionFlagsBits, PermissionsBitField, type Guild, type OverwriteData, type VoiceChannel } from 'discord.js';
import type { VoiceCreator, VoiceRoom, VoiceSettings } from '@scrt/validation';

const view = PermissionFlagsBits.ViewChannel;
const connect = PermissionFlagsBits.Connect;
const send = PermissionFlagsBits.SendMessages;
const history = PermissionFlagsBits.ReadMessageHistory;

function bits(values: readonly bigint[]): bigint { return values.reduce((sum, value) => sum | value, 0n); }
function data(id: string, type: OverwriteType, allow: bigint, deny: bigint): OverwriteData {
  return { id, type, allow: new PermissionsBitField(allow), deny: new PermissionsBitField(deny) };
}

export function roomOverwrites(guild: Guild, channel: VoiceChannel, creator: VoiceCreator, settings: VoiceSettings, room: VoiceRoom): OverwriteData[] {
  const source = guild.channels.cache.get(creator.channelId);
  const baseline = channel.parent?.permissionOverwrites.cache ?? (source && 'permissionOverwrites' in source ? source.permissionOverwrites.cache : channel.permissionOverwrites.cache);
  const result = new Map<string, { type: OverwriteType; allow: bigint; deny: bigint }>();
  for (const overwrite of baseline.values()) result.set(overwrite.id, { type: overwrite.type, allow: overwrite.allow.bitfield, deny: overwrite.deny.bitfield });
  function adjust(id: string, type: OverwriteType, allow: bigint, deny: bigint) {
    const current = result.get(id) ?? { type, allow: 0n, deny: 0n };
    result.set(id, { type, allow: (current.allow & ~deny) | allow, deny: (current.deny & ~allow) | deny });
  }
  const roleRestricted = creator.allowedRoleIds.length > 0;
  const restricted = bits([room.locked || roleRestricted ? connect : 0n, room.hidden || roleRestricted ? view : 0n, room.chatClosed ? send : 0n]);
  if (restricted) {
    for (const [id, current] of result) {
      if (current.type === OverwriteType.Role) adjust(id, current.type, 0n, restricted);
    }
    adjust(guild.id, OverwriteType.Role, 0n, restricted);
  }
  for (const roleId of creator.allowedRoleIds) adjust(roleId, OverwriteType.Role, bits([view, room.locked ? 0n : connect, room.chatClosed ? 0n : send]), bits([room.locked ? connect : 0n, room.chatClosed ? send : 0n]));
  for (const roleId of [...settings.bypassRoleIds, ...creator.bypassRoleIds]) adjust(roleId, OverwriteType.Role, bits([view, connect, send, history]), 0n);
  for (const userId of room.permittedUserIds) adjust(userId, OverwriteType.Member, bits([view, connect, send, history]), 0n);
  for (const userId of room.blockedUserIds) adjust(userId, OverwriteType.Member, 0n, bits([view, connect]));
  if (result.size > 0) {
    if (room.ownerId && room.ownerId !== guild.ownerId) adjust(room.ownerId, OverwriteType.Member, bits([view, connect, send, history]), 0n);
    if (guild.members.me) adjust(guild.members.me.id, OverwriteType.Member, bits([view, connect, send, history]), 0n);
  }
  return [...result].map(([id, value]) => data(id, value.type, value.allow, value.deny));
}

export async function reconcileRoomPermissions(guild: Guild, channel: VoiceChannel, creator: VoiceCreator, settings: VoiceSettings, room: VoiceRoom): Promise<void> {
  const desired = roomOverwrites(guild, channel, creator, settings, room);
  const actual = channel.permissionOverwrites.cache;
  const unchanged = actual.size === desired.length && desired.every((entry) => {
    const current = actual.get(entry.id as string);
    return current !== undefined && current.type === entry.type && current.allow.bitfield === PermissionsBitField.resolve(entry.allow) && current.deny.bitfield === PermissionsBitField.resolve(entry.deny);
  });
  if (!unchanged) await channel.permissionOverwrites.set(desired, 'SCRT voice room access');
}
