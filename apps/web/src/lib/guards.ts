import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { canManageGuild, discordGuilds, discordUser, currentGuildMember, DiscordApiError } from '@scrt/discord';
import { PermissionService, type AppPermission } from '@scrt/permissions';
import { guildIdSchema } from '@scrt/validation';
import { accessToken, sessionUser } from './session';
import { guilds } from './server';

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
const cachedMember = cache(currentGuildMember);
const cachedRecord = cache((guildId: string) => guilds().get(guildId));
const cachedMappings = cache((guildId: string) => guilds().roleMappings(guildId));
export async function requireSession(next = '/servers') {
  const token = requireTokenRedirect(next, await accessToken());
  return { token, user: await sessionUser() ?? await withUserToken(next, () => cachedUser(token)) };
}
export async function manageableGuilds() {
  const token = requireTokenRedirect('/servers', await accessToken());
  return (await withUserToken('/servers', () => cachedGuilds(token))).filter(canManageGuild);
}
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
  const privileged = listed.owner || canManageGuild(listed);
  const mappings = privileged ? [] : await cachedMappings(guildId);
  const member = mappings.length ? await withUserToken(`/servers/${guildId}`, () => cachedMember(token, guildId)) : null;
  const input = { userId: user.id, ownerId: listed.owner ? user.id : '', discordRoleIds: member?.roles ?? [], mappings, hasManageGuild: canManageGuild(listed) };
  return { guild: record, discordGuild: listed, user, input, token };
});
export async function requireGuildAccess(rawGuildId: string, permission: AppPermission = 'dashboard.access') {
  const guildId = guildIdSchema.parse(rawGuildId);
  const access = await guildAccess(guildId);
  let input = access.input;
  if (permission === 'settings.manage' && !access.discordGuild.owner && input.mappings.length === 0) {
    const mappings = await cachedMappings(guildId);
    const member = mappings.length ? await withUserToken(`/servers/${guildId}`, () => cachedMember(access.token, guildId)) : null;
    input = { ...input, mappings, discordRoleIds: member?.roles ?? [] };
  }
  new PermissionService().require(input, permission);
  return { guild: access.guild, discordGuild: access.discordGuild, user: access.user, permissions: new PermissionService().permissionsFor(input) };
}
