import 'server-only';
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
export async function requireSession(next = '/servers') {
  const token = requireTokenRedirect(next, await accessToken());
  return { token, user: await discordUser(token) };
}
export async function manageableGuilds() {
  const { token } = await requireSession('/servers');
  return (await discordGuilds(token)).filter(canManageGuild);
}
export async function requireGuildAccess(rawGuildId: string, permission: AppPermission = 'dashboard.access') {
  const guildId = guildIdSchema.parse(rawGuildId);
  const { token, user } = await requireSession(`/servers/${guildId}`);
  const listed = (await discordGuilds(token)).find((guild) => guild.id === guildId);
  if (!listed) throw new Error('Forbidden');
  const record = await guilds().get(guildId);
  if (!record?.botInstalled) throw new Error('Bot not installed');
  const liveGuild = await botGuild(env().DISCORD_BOT_TOKEN, guildId);
  const isOwner = user.id === liveGuild.owner_id;
  const member = isOwner ? null : await currentGuildMember(token, guildId);
  const input = { userId: user.id, ownerId: liveGuild.owner_id, discordRoleIds: member?.roles ?? [], mappings: await guilds().roleMappings(guildId), hasManageGuild: canManageGuild(listed) };
  new PermissionService().require(input, permission);
  return { guild: record, user, permissions: new PermissionService().permissionsFor(input), ownerId: liveGuild.owner_id, mappings: input.mappings };
}
