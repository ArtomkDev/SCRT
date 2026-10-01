import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { botGuildMember, canManageGuild, discordGuilds, discordUser, DiscordApiError } from '@scrt/discord';
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
    const member = await botGuildMember(env().DISCORD_BOT_TOKEN, guildId, userId);
    if (member.user.id !== userId) throw new Error('Forbidden');
    return member;
  } catch (error) {
    if (error instanceof DiscordApiError && error.status === 404) return null;
    throw error;
  }
});
const cachedRecord = cache((guildId: string) => guilds().get(guildId));
const cachedMappings = cache((guildId: string) => guilds().accessMappings(guildId));
export async function requireSession(next = '/servers') {
  const token = requireTokenRedirect(next, await accessToken());
  return { token, user: await sessionUser() ?? await withUserToken(next, () => cachedUser(token)) };
}
export async function manageableGuildList() {
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
}
export async function manageableGuilds() { return (await manageableGuildList()).list; }
const guildAccess = cache(async (guildId: string) => {
  const token = requireTokenRedirect(`/servers/${guildId}`, await accessToken());
  const [user, userGuilds, record] = await Promise.all([
    sessionUser().then((stored) => stored ?? withUserToken(`/servers/${guildId}`, () => cachedUser(token))),
    withUserToken(`/servers/${guildId}`, () => cachedGuilds(token)),
    cachedRecord(guildId),
  ]);
  const listed = userGuilds.find((guild) => guild.id === guildId);
  if (!listed) throw new Error('Forbidden');
  if (!record?.botInstalled) throw new Error('Bot not installed');
  const mappings = listed.owner ? { roles: [], members: [] } : await cachedMappings(guildId);
  const needsRoles = mappings.roles.some((mapping) => mapping.discordRoleId !== guildId);
  const member = needsRoles ? await liveMember(guildId, user.id) : null;
  if (needsRoles && !member) throw new Error('Forbidden');
  const input = { guildId, userId: user.id, ownerId: listed.owner ? user.id : '', discordRoleIds: member?.roles ?? [], mappings: mappings.roles, memberMappings: mappings.members };
  return { guild: record, discordGuild: listed, user, input };
});
export async function requireGuildAccess(rawGuildId: string, permission: AppPermission = 'dashboard.access') {
  const guildId = guildIdSchema.parse(rawGuildId);
  const access = await guildAccess(guildId);
  const input = access.input;
  new PermissionService().require(input, permission);
  const accessActor = { guildId, userId: access.user.id, isOwner: access.discordGuild.owner, discordRoleIds: input.discordRoleIds };
  return { guild: access.guild, discordGuild: access.discordGuild, user: access.user, accessActor, permissions: new PermissionService().permissionsFor(input) };
}
