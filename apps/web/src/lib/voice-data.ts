import 'server-only';
import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { botGuildChannels, botGuildMember, botGuildRoles, botSelf, botVoiceRegions, effectiveBotPermissions, requiredBotPermissions, type BotChannel } from '@scrt/discord';
import { env, voice } from './server';

const cachedBotSelf = unstable_cache(() => botSelf(env().DISCORD_BOT_TOKEN), ['voice-bot-self'], { revalidate: 3600 });

export const voiceChannels = cache((guildId: string, resourceRevision = 0) => unstable_cache(
  () => botGuildChannels(env().DISCORD_BOT_TOKEN, guildId),
  ['voice-channels', guildId, String(resourceRevision)], { revalidate: 30, tags: [`voice-channels:${guildId}`] },
)());
export const voiceRoles = cache((guildId: string, resourceRevision = 0) => unstable_cache(
  () => botGuildRoles(env().DISCORD_BOT_TOKEN, guildId),
  ['voice-roles', guildId, String(resourceRevision)], { revalidate: 30, tags: [`voice-roles:${guildId}`] },
)());
export const voiceResources = cache(async (guildId: string, resourceRevision = 0) => {
  const [channels, roles] = await Promise.all([voiceChannels(guildId, resourceRevision), voiceRoles(guildId, resourceRevision)]);
  return { channels, roles };
});
export const voicePermissionResources = cache(async (guildId: string, resourceRevision = 0) => {
  const [resources, self] = await Promise.all([voiceResources(guildId, resourceRevision), cachedBotSelf()]);
  const member = await botGuildMember(env().DISCORD_BOT_TOKEN, guildId, self.id);
  return { ...resources, botId: self.id, botRoleIds: member.roles };
});

const cachedVoiceRegions = unstable_cache(() => botVoiceRegions(env().DISCORD_BOT_TOKEN), ['voice-regions'], { revalidate: 3600 });
export const voiceRegions = cache(() => cachedVoiceRegions());
export const voiceSettings = cache((guildId: string) => voice().getSettings(guildId));
export const voiceCreators = cache((guildId: string) => voice().listCreators(guildId));
export const voiceRooms = cache((guildId: string) => voice().listRooms(guildId));
export const voiceRoomChannels = cache(async (guildId: string, resourceRevision = 0) => {
  const [rooms, channels] = await Promise.all([voiceRooms(guildId), voiceChannels(guildId, resourceRevision)]);
  if (rooms.every((room) => channels.some((channel) => channel.id === room.channelId && channel.name))) return channels;
  try {
    return await botGuildChannels(env().DISCORD_BOT_TOKEN, guildId);
  } catch (error) {
    console.error('Could not refresh voice room channel names', { guildId, error });
    return channels;
  }
});
export const voiceInterfaces = cache((guildId: string) => voice().listInterfaces(guildId));
export const voiceRecords = cache(async (guildId: string) => {
  const [settings, creators, rooms] = await Promise.all([voiceSettings(guildId), voiceCreators(guildId), voiceRooms(guildId)]);
  return { settings, creators, rooms };
});
export function permissionStatus(guildId: string, data: Awaited<ReturnType<typeof voicePermissionResources>>, channel?: BotChannel) {
  const permissions = effectiveBotPermissions(guildId, data.botRoleIds, data.roles, channel, data.botId);
  return requiredBotPermissions.map((flag) => ({ flag, granted: (permissions & flag) === flag }));
}
