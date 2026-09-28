import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { canManageGuild, discordGuilds, discordUser, botGuild, currentGuildMember } from '@scrt/discord';
import { PermissionService, type AppPermission } from '@scrt/permissions';
import { guildIdSchema } from '@scrt/validation';
import { accessToken } from './session';
import { env, guilds } from './server';

function requireTokenRedirect(next: string, token: string | null): string {
  if (!token) redirect(`/api/auth/refresh?next=${encodeURIComponent(next)}`);
  return token;
}
const cachedUser = cache(discordUser);
const cachedGuilds = cache(discordGuilds);
const cachedBotGuild = cache(botGuild);
const cachedMember = cache(currentGuildMember);
const cachedRecord = cache((guildId: string) => guilds().get(guildId));
const cachedMappings = cache((guildId: string) => guilds().roleMappings(guildId));
export async function requireSession(next = '/servers') {
  const token = requireTokenRedirect(next, await accessToken());
  return { token, user: await cachedUser(token) };
}
export async function manageableGuilds() {
  const token = requireTokenRedirect('/servers', await accessToken());
  return (await cachedGuilds(token)).filter(canManageGuild);
}
export async function requireGuildAccess(rawGuildId: string, permission: AppPermission = 'dashboard.access') {
  const guildId = guildIdSchema.parse(rawGuildId);
  const token = requireTokenRedirect(`/servers/${guildId}`, await accessToken());
  const [user, userGuilds] = await Promise.all([cachedUser(token), cachedGuilds(token)]);
  const listed = userGuilds.find((guild) => guild.id === guildId);
  if (!listed) throw new Error('Forbidden');
  const record = await cachedRecord(guildId);
  if (!record?.botInstalled) throw new Error('Bot not installed');
  const liveGuild = await cachedBotGuild(env().DISCORD_BOT_TOKEN, guildId);
  const isOwner = user.id === liveGuild.owner_id;
  const member = isOwner ? null : await cachedMember(token, guildId);
  const input = { userId: user.id, ownerId: liveGuild.owner_id, discordRoleIds: member?.roles ?? [], mappings: await cachedMappings(guildId), hasManageGuild: canManageGuild(listed) };
  new PermissionService().require(input, permission);
  return { guild: record, discordGuild: listed, user, permissions: new PermissionService().permissionsFor(input), ownerId: liveGuild.owner_id, mappings: input.mappings };
}
