import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { botGuild, botGuildMember, canManageGuild, discordGuilds, discordUser, DiscordApiError } from '@scrt/discord';
import { PermissionService, type AppPermission } from '@scrt/permissions';
import { guildIdSchema } from '@scrt/validation';
import { accessToken, sessionUser } from './session';
import { env, guilds } from './server';

function requireTokenRedirect(next: string, token: string | null): string {
  if (!token) redirect(`/api/auth/refresh?next=${encodeURIComponent(next)}`);
  return token;
}
async function withUserToken<T>(next: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DiscordApiError && error.status === 401) {
      redirect(`/api/auth/refresh?force=1&next=${encodeURIComponent(next)}`);
    }
    throw error;
  }
}
const cachedUser = cache(discordUser);
const cachedGuilds = cache(discordGuilds);
// Request-scoped only: authorization must not reuse cached directory/profile roles.
const liveMember = cache(async (guildId: string, userId: string) => {
  try {
    const member = await botGuildMember(env().DISCORD_BOT_TOKEN, guildId, userId, { priority: 'interactive' });
    if (member.user.id !== userId) throw new Error('Forbidden');
    return member;
  } catch (error) {
    if (error instanceof DiscordApiError && error.status === 404) return null;
    throw error;
  }
});
const cachedRecord = cache((guildId: string) => guilds().get(guildId));
const cachedMappings = cache((guildId: string) => guilds().accessMappings(guildId));
const liveGuild = cache(async (guildId: string) => {
  try {
    const guild = await botGuild(env().DISCORD_BOT_TOKEN, guildId, { priority: 'interactive' });
    if (guild.id !== guildId) throw new Error('Forbidden');
    return guild;
  } catch (error) {
    if (error instanceof DiscordApiError && error.status === 404) throw new Error('Bot not installed', { cause: error });
    throw error;
  }
});
export async function requireSession(next = '/servers') {
  const token = requireTokenRedirect(next, await accessToken());
  return { token, user: await sessionUser() ?? await withUserToken(next, () => cachedUser(token)) };
}
// Shared by the persistent rail and /servers during the same server render.
export const manageableGuildList = cache(async () => {
  const token = requireTokenRedirect('/servers', await accessToken());
  const [listed, user] = await Promise.all([
    withUserToken('/servers', () => cachedGuilds(token)),
    sessionUser().then((stored) => stored ?? withUserToken('/servers', () => cachedUser(token))),
  ]);
  const installed = await guilds().installedGuildIds(listed.map((guild) => guild.id));
  const accessible = await Promise.all(listed.map(async (guild) => {
    if (guild.owner) return true;
    if (!installed.has(guild.id)) return canManageGuild(guild);
    const mappings = await cachedMappings(guild.id);
    if (!mappings.roles.length && !mappings.members.length) return false;
    const input = { guildId: guild.id, userId: user.id, ownerId: '', discordRoleIds: [] as string[], mappings: mappings.roles, memberMappings: mappings.members };
    const permissions = new PermissionService();
    // Live guild membership plus @everyone/personal access is sufficient for the list.
    if (permissions.permissionsFor(input).has('dashboard.access')) return true;
    if (!mappings.roles.some((mapping) => mapping.discordRoleId !== guild.id)) return false;
    const member = await liveMember(guild.id, user.id);
    return member !== null && permissions.permissionsFor({ ...input, discordRoleIds: member.roles }).has('dashboard.access');
  }));
  return { list: listed.filter((_, index) => accessible[index]), installedIds: installed };
});
export async function manageableGuilds() { return (await manageableGuildList()).list; }
const guildAccess = cache(async (guildId: string) => {
  const { user } = await requireSession(`/servers/${guildId}`);
  // All live facts for this guild are independent. The OAuth guild list is only
  // needed on /servers; fetching it on every tab consumes its shared quota.
  const [guild, member, record, mappings] = await Promise.all([
    liveGuild(guildId), liveMember(guildId, user.id), cachedRecord(guildId), cachedMappings(guildId),
  ]);
  if (!record?.botInstalled) throw new Error('Bot not installed');
  if (!member) throw new Error('Forbidden');
  const discordGuild = { id: guild.id, name: guild.name, icon: guild.icon, owner: guild.owner_id === user.id };
  const input = { guildId, userId: user.id, ownerId: guild.owner_id, discordRoleIds: member.roles, mappings: mappings.roles, memberMappings: mappings.members };
  return { guild: record, discordGuild, liveGuild: guild, user, input };
});
export async function requireGuildAccess(rawGuildId: string, permission: AppPermission = 'dashboard.access') {
  const guildId = guildIdSchema.parse(rawGuildId);
  const access = await guildAccess(guildId);
  const input = access.input;
  new PermissionService().require(input, permission);
  const accessActor = { guildId, userId: access.user.id, isOwner: access.discordGuild.owner, discordRoleIds: input.discordRoleIds };
  return { guild: access.guild, discordGuild: access.discordGuild, liveGuild: access.liveGuild, user: access.user, accessActor, accessMappings: { roles: input.mappings, members: input.memberMappings }, permissions: new PermissionService().permissionsFor(input) };
}
