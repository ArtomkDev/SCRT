import { discordGuildSchema, discordUserSchema } from '@scrt/validation';
import { z } from 'zod';
import { PermissionFlagsBits } from 'discord-api-types/v10';
import { voicePanelRows } from './voice-panel';
export { voiceComponentPrefix, voicePanelRows } from './voice-panel';

export const requiredBotPermissions = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.MoveMembers,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
] as const;
export const botPermissions = requiredBotPermissions.reduce((value, permission) => value | permission, 0n);
export const discordScopes = 'identify guilds guilds.members.read';
const api = 'https://discord.com/api/v10';

export function loginUrl(clientId: string, redirectUri: string, state: string, challenge: string): string {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: discordScopes, state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'consent' }).toString();
  return url.toString();
}
export function installUrl(clientId: string, guildId: string): string {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({ client_id: clientId, scope: 'bot applications.commands', guild_id: guildId, disable_guild_select: 'true', permissions: botPermissions.toString() }).toString();
  return url.toString();
}
export type DiscordTokens = { access_token: string; refresh_token: string; expires_in: number; token_type: string };
const tokensSchema = z.object({ access_token: z.string(), refresh_token: z.string(), expires_in: z.number(), token_type: z.string() });
export class DiscordApiError extends Error {
  constructor(readonly status: number) {
    super(`Discord API failed (${status})`);
    this.name = 'DiscordApiError';
  }
}
const pendingGets = new Map<string, Promise<unknown>>();
async function performRequest<T>(url: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  const readable = !init.method || init.method === 'GET';
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: readable ? AbortSignal.timeout(8_000) : init.signal });
    } catch (error) {
      if (!readable || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      continue;
    }
    if (response.status === 429 && attempt < 2 && readable) {
      const retryAfter = Number(response.headers.get('retry-after'));
      if (Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 10) {
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        continue;
      }
    }
    if ([502, 503, 504].includes(response.status) && attempt < 2 && readable) {
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      continue;
    }
    if (!response.ok) throw new DiscordApiError(response.status);
    return schema.parse(await response.json());
  }
}
function request<T>(url: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  if (init.method && init.method !== 'GET') return performRequest(url, init, schema);
  const key = `${new Headers(init.headers).get('authorization') ?? ''}:${url}`;
  const pending = pendingGets.get(key);
  if (pending) return pending as Promise<T>;
  const result = performRequest(url, init, schema);
  pendingGets.set(key, result);
  void result.finally(() => { if (pendingGets.get(key) === result) pendingGets.delete(key); }).catch(() => {});
  return result;
}
export function exchangeCode(clientId: string, clientSecret: string, redirectUri: string, code: string, verifier: string) {
  return request(`${api}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier }) }, tokensSchema);
}
export function refreshTokens(clientId: string, clientSecret: string, refreshToken: string) {
  return request(`${api}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }) }, tokensSchema);
}
export function discordUser(accessToken: string) { return request(`${api}/users/@me`, { headers: { authorization: `Bearer ${accessToken}` } }, discordUserSchema); }
export type DiscordUser = z.infer<typeof discordUserSchema>;
export function discordGuilds(accessToken: string) { return request(`${api}/users/@me/guilds`, { headers: { authorization: `Bearer ${accessToken}` } }, z.array(discordGuildSchema)); }
export type DiscordGuild = z.infer<typeof discordGuildSchema>;
export function canManageGuild(guild: DiscordGuild) { const bits = BigInt(guild.permissions); return guild.owner || (bits & (1n << 5n)) !== 0n || (bits & (1n << 3n)) !== 0n; }

const memberSchema = z.object({ roles: z.array(z.string()) });
const guildSchema = z.object({ id: z.string(), owner_id: z.string(), name: z.string(), icon: z.string().nullable() });
export function botGuild(botToken: string, guildId: string) { return request(`${api}/guilds/${guildId}`, { headers: { authorization: `Bot ${botToken}` } }, guildSchema); }
export function currentGuildMember(accessToken: string, guildId: string) { return request(`${api}/users/@me/guilds/${guildId}/member`, { headers: { authorization: `Bearer ${accessToken}` } }, memberSchema); }

const channelSchema = z.object({ id: z.string(), guild_id: z.string().optional(), name: z.string().optional(), type: z.number(), parent_id: z.string().nullable().optional(), permission_overwrites: z.array(z.object({ id: z.string(), type: z.number(), allow: z.string(), deny: z.string() })).optional() });
export type BotChannel = z.infer<typeof channelSchema>;
export function botGuildChannels(botToken: string, guildId: string) { return request(`${api}/guilds/${guildId}/channels`, { headers: { authorization: `Bot ${botToken}` } }, z.array(channelSchema)); }
export function botGuildRoles(botToken: string, guildId: string) { return request(`${api}/guilds/${guildId}/roles`, { headers: { authorization: `Bot ${botToken}` } }, z.array(z.object({ id: z.string(), name: z.string(), permissions: z.string() }))); }
export function botSelf(botToken: string) { return request(`${api}/users/@me`, { headers: { authorization: `Bot ${botToken}` } }, z.object({ id: z.string() })); }
export function botGuildMember(botToken: string, guildId: string, userId: string) { return request(`${api}/guilds/${guildId}/members/${userId}`, { headers: { authorization: `Bot ${botToken}` } }, z.object({ roles: z.array(z.string()) })); }
export function botVoiceRegions(botToken: string) { return request(`${api}/voice/regions`, { headers: { authorization: `Bot ${botToken}` } }, z.array(z.object({ id: z.string(), name: z.string() }))); }
export function botCreateVoiceChannel(botToken: string, guildId: string, name: string, parentId: string | null) {
  return request(`${api}/guilds/${guildId}/channels`, { method: 'POST', headers: { authorization: `Bot ${botToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ name, type: 2, parent_id: parentId }) }, channelSchema);
}
export function botRenameVoiceChannel(botToken: string, channelId: string, name: string) {
  return request(`${api}/channels/${channelId}`, { method: 'PATCH', headers: { authorization: `Bot ${botToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ name }) }, channelSchema);
}
export async function botDeleteChannel(botToken: string, channelId: string): Promise<void> {
  const response = await fetch(`${api}/channels/${channelId}`, { method: 'DELETE', headers: { authorization: `Bot ${botToken}` } });
  if (!response.ok && response.status !== 404) throw new Error(`Discord API failed (${response.status})`);
}
export function botCreateVoiceInterfaceMessage(botToken: string, channelId: string) {
  return request(`${api}/channels/${channelId}/messages`, { method: 'POST', headers: { authorization: `Bot ${botToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Керування голосовою кімнатою\nСтвори кімнату через Creator-канал, а потім використовуй кнопки нижче.', components: voicePanelRows() }) }, z.object({ id: z.string(), channel_id: z.string() }));
}
export async function botDeleteVoiceInterfaceMessage(botToken: string, channelId: string, messageId: string): Promise<void> {
  const response = await fetch(`${api}/channels/${channelId}/messages/${messageId}`, { method: 'DELETE', headers: { authorization: `Bot ${botToken}` } });
  if (!response.ok && response.status !== 404) throw new Error(`Discord API failed (${response.status})`);
}

export type BotRole = { id: string; name: string; permissions: string };
export function effectiveBotPermissions(guildId: string, roleIds: readonly string[], roles: readonly BotRole[], channel?: BotChannel, botId?: string): bigint {
  let permissions = 0n;
  for (const role of roles) if (role.id === guildId || roleIds.includes(role.id)) permissions |= BigInt(role.permissions);
  if ((permissions & PermissionFlagsBits.Administrator) !== 0n) return botPermissions;
  if (!channel) return permissions;
  const overwrites = channel.permission_overwrites ?? [];
  const everyone = overwrites.find((entry) => entry.id === guildId);
  if (everyone) permissions = (permissions & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
  const roleOverwrites = overwrites.filter((entry) => entry.type === 0 && roleIds.includes(entry.id));
  const roleDeny = roleOverwrites.reduce((value, entry) => value | BigInt(entry.deny), 0n);
  const roleAllow = roleOverwrites.reduce((value, entry) => value | BigInt(entry.allow), 0n);
  permissions = (permissions & ~roleDeny) | roleAllow;
  const member = botId ? overwrites.find((entry) => entry.type === 1 && entry.id === botId) : null;
  if (member) permissions = (permissions & ~BigInt(member.deny)) | BigInt(member.allow);
  return permissions;
}
