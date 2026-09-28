import { discordGuildSchema, discordUserSchema } from '@scrt/validation';
import { z } from 'zod';

export const botPermissions = 0n; // /ping and guild metadata need no elevated permissions.
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
async function request<T>(url: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Discord API failed (${response.status})`);
  return schema.parse(await response.json());
}
export function exchangeCode(clientId: string, clientSecret: string, redirectUri: string, code: string, verifier: string) {
  return request(`${api}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier }) }, tokensSchema);
}
export function refreshTokens(clientId: string, clientSecret: string, refreshToken: string) {
  return request(`${api}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }) }, tokensSchema);
}
export function discordUser(accessToken: string) { return request(`${api}/users/@me`, { headers: { authorization: `Bearer ${accessToken}` } }, discordUserSchema); }
export function discordGuilds(accessToken: string) { return request(`${api}/users/@me/guilds`, { headers: { authorization: `Bearer ${accessToken}` } }, z.array(discordGuildSchema)); }
export type DiscordGuild = z.infer<typeof discordGuildSchema>;
export function canManageGuild(guild: DiscordGuild) { const bits = BigInt(guild.permissions); return guild.owner || (bits & (1n << 5n)) !== 0n || (bits & (1n << 3n)) !== 0n; }

const memberSchema = z.object({ roles: z.array(z.string()) });
const guildSchema = z.object({ id: z.string(), owner_id: z.string(), name: z.string(), icon: z.string().nullable() });
export function botGuild(botToken: string, guildId: string) { return request(`${api}/guilds/${guildId}`, { headers: { authorization: `Bot ${botToken}` } }, guildSchema); }
export function currentGuildMember(accessToken: string, guildId: string) { return request(`${api}/users/@me/guilds/${guildId}/member`, { headers: { authorization: `Bearer ${accessToken}` } }, memberSchema); }
