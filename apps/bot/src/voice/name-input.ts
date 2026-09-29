import type { GuildMember } from 'discord.js';
import { renderVoiceRoomName, type VoiceCreator, type VoiceNameInput } from '@scrt/validation';

export function voiceNameInput(member: GuildMember, creator: VoiceCreator, counter: number, categoryName?: string | null): VoiceNameInput {
  const highest = member.roles.highest;
  return {
    username: member.user.username,
    displayName: member.displayName,
    userId: member.id,
    accountCreatedAt: member.user.createdTimestamp,
    serverJoinedAt: member.joinedTimestamp,
    highestRole: highest.id === member.guild.id ? null : highest.name,
    hoistRole: member.roles.hoist?.name,
    serverName: member.guild.name,
    serverId: member.guild.id,
    creatorName: member.guild.channels.cache.get(creator.channelId)?.name,
    creatorId: creator.channelId,
    categoryName,
    privacy: creator.defaultHidden ? 'hidden' : creator.defaultLocked ? 'locked' : 'open',
    counter,
  };
}

export function voiceRoomName(member: GuildMember, creator: VoiceCreator, counter: number, categoryName?: string | null): string {
  try { return renderVoiceRoomName(creator.nameTemplate, voiceNameInput(member, creator, counter, categoryName)); }
  catch { return `Кімната ${member.user.username}`.slice(0, 100); }
}
