import { discordGuildSchema, discordUserSchema, snowflakeSchema, type DirectoryMember } from '@scrt/validation';
import { z } from 'zod';
import { ApplicationFlags, PermissionFlagsBits } from 'discord-api-types/v10';
import { voicePanelRows } from './voice-panel';
export { voiceComponentPrefix, voicePanelRows } from './voice-panel';

export const requiredBotPermissions = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.MoveMembers,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
] as const;
export const botPermissions = requiredBotPermissions.reduce((value, permission) => value | permission, 0n);
export const requiredMediaBotPermissions = [['ViewChannel', PermissionFlagsBits.ViewChannel], ['Connect', PermissionFlagsBits.Connect], ['Speak', PermissionFlagsBits.Speak]] as const;
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
export function installAuthorizationUrl(clientId: string, guildId: string, redirectUri: string, state: string, challenge: string): string {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: clientId, guild_id: snowflakeSchema.parse(guildId), disable_guild_select: 'true', integration_type: '0',
    scope: 'bot applications.commands identify', permissions: botPermissions.toString(),
    redirect_uri: redirectUri, response_type: 'code', state, code_challenge: challenge, code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}
export type DiscordTokens = { access_token: string; refresh_token: string; expires_in: number; token_type: string };
const tokensSchema = z.object({ access_token: z.string(), refresh_token: z.string(), expires_in: z.number(), token_type: z.string() });
export class DiscordApiError extends Error {
  constructor(readonly status: number, readonly endpoint?: string, readonly code?: string) {
    super(`Discord API failed (${status})${endpoint ? ` on ${endpoint}` : ''}`);
    this.name = 'DiscordApiError';
  }
}
const pendingGets = new Map<string, Promise<unknown>>();
export type DiscordRequestOptions = { priority?: 'interactive' | 'normal' };
type QueuedCall = { url: string; priority: 'interactive' | 'normal'; start: () => void };
type RouteQueue = { active: boolean; calls: QueuedCall[]; interactiveRun: number };
const routeQueues = new Map<string, RouteQueue>();
const routeCooldowns = new Map<string, number>();
const globalCooldowns = new Map<string, number>();
let queuedRequests = 0;
const maxRateLimitEntries = 1_000;
const maxQueueWaitMs = 10_000;
const maxRequestWaitMs = 30_000;
const maxQueuedRequests = 512;
const maxQueuedPerRoute = 64;

function rateLimitKey(url: string, init: RequestInit): { route: string; auth: string; endpoint: string } {
  const parsed = new URL(url);
  const auth = new Headers(init.headers).get('authorization') ?? '';
  const path = parsed.pathname.replace(/\/\d{17,20}(?=\/|$)/g, '/:id');
  const majorId = parsed.pathname.match(/\/(?:guilds|channels)\/(\d{17,20})(?:\/|$)/)?.[1] ?? '';
  const endpoint = `${init.method ?? 'GET'} ${path}`;
  return { route: `${auth}:${endpoint}:${majorId}`, auth, endpoint };
}

function rememberCooldown(map: Map<string, number>, key: string, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < 0) return;
  if (map.size >= maxRateLimitEntries && !map.has(key)) map.delete(map.keys().next().value ?? '');
  map.set(key, Math.max(map.get(key) ?? 0, Date.now() + Math.ceil(seconds * 1_000)));
}

async function waitForCooldown(route: string, auth: string, endpoint: string, deadline: number): Promise<void> {
  while (true) {
    const until = Math.max(routeCooldowns.get(route) ?? 0, auth ? globalCooldowns.get(auth) ?? 0 : 0);
    if (until <= Date.now()) break;
    if (until > deadline) throw new DiscordApiError(429, endpoint);
    await new Promise((resolve) => setTimeout(resolve, until - Date.now()));
  }
  if ((routeCooldowns.get(route) ?? 0) <= Date.now()) routeCooldowns.delete(route);
  if (auth && (globalCooldowns.get(auth) ?? 0) <= Date.now()) globalCooldowns.delete(auth);
}

function retrySeconds(response: Response, body?: unknown): number | null {
  const payload = body && typeof body === 'object' ? body as Record<string, unknown> : null;
  for (const value of [response.headers.get('retry-after'), payload?.retry_after, response.headers.get('x-ratelimit-reset-after')]) {
    const seconds = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  }
  return null;
}

function runNext(route: string, queue: RouteQueue): void {
  if (queue.active) return;
  if (!queue.calls.length) {
    if (routeQueues.get(route) === queue) routeQueues.delete(route);
    return;
  }
  // Interactive checks may overtake queued presentation reads, never an active
  // request or a Discord cooldown. Reserve every fifth turn for normal work.
  const interactive = queue.interactiveRun < 4 ? queue.calls.findIndex((call) => call.priority === 'interactive') : -1;
  const normal = queue.calls.findIndex((call) => call.priority === 'normal');
  const index = interactive >= 0 ? interactive : normal >= 0 ? normal : 0;
  const call = queue.calls.splice(index, 1)[0]!;
  queue.interactiveRun = call.priority === 'interactive' ? queue.interactiveRun + 1 : 0;
  queue.active = true;
  call.start();
}

function queuedRequest<T>(url: string, init: RequestInit, schema: z.ZodType<T>, options: DiscordRequestOptions): Promise<T> {
  const { route, auth, endpoint } = rateLimitKey(url, init);
  let queue = routeQueues.get(route);
  if (!queue) { queue = { active: false, calls: [], interactiveRun: 0 }; routeQueues.set(route, queue); }
  if (queuedRequests >= maxQueuedRequests || queue.calls.length + Number(queue.active) >= maxQueuedPerRoute) {
    if (!queue.active && !queue.calls.length) routeQueues.delete(route);
    return Promise.reject(new DiscordApiError(503, endpoint));
  }
  queuedRequests++;
  const deadline = Date.now() + maxRequestWaitMs;
  const current = queue;
  return new Promise<T>((resolve, reject) => {
    const call: QueuedCall = { url, priority: options.priority ?? 'normal', start: () => {
      clearTimeout(timer);
      void performRequest(url, init, schema, route, auth, endpoint, deadline).then(resolve, reject).finally(() => {
        queuedRequests--;
        current.active = false;
        runNext(route, current);
      });
    } };
    const timer = setTimeout(() => {
      const index = current.calls.indexOf(call);
      if (index < 0) return;
      current.calls.splice(index, 1);
      queuedRequests--;
      reject(new Error(`Discord request queue timed out on ${endpoint}`));
      runNext(route, current);
    }, maxQueueWaitMs);
    current.calls.push(call);
    runNext(route, current);
  });
}
async function performRequest<T>(url: string, init: RequestInit, schema: z.ZodType<T>, route: string, auth: string, endpoint: string, deadline: number): Promise<T> {
  const readable = !init.method || init.method === 'GET';
  for (let attempt = 0; ; attempt++) {
    await waitForCooldown(route, auth, endpoint, deadline);
    if (Date.now() >= deadline) throw new Error(`Discord request timed out on ${endpoint}`);
    let response: Response;
    try {
      const timeout = AbortSignal.timeout(Math.max(1, Math.min(8_000, deadline - Date.now())));
      response = await fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
    } catch (error) {
      if (!readable || attempt >= 2 || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      continue;
    }
    if (response.status === 429) {
      const body: unknown = await response.json().catch(() => null);
      const retryAfter = retrySeconds(response, body) ?? Math.min(2 ** attempt, 10);
      const global = response.headers.get('x-ratelimit-global') === 'true'
        || (body !== null && typeof body === 'object' && (body as Record<string, unknown>).global === true);
      rememberCooldown(global && auth ? globalCooldowns : routeCooldowns, global && auth ? auth : route, retryAfter);
      console.warn('Discord API rate limited', { endpoint, retryAfterSeconds: retryAfter, global, scope: response.headers.get('x-ratelimit-scope') });
      if (attempt < 3) continue;
    }
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining === '0') {
      const resetAfter = Number(response.headers.get('x-ratelimit-reset-after'));
      rememberCooldown(routeCooldowns, route, resetAfter);
    }
    if ([502, 503, 504].includes(response.status) && attempt < 2 && readable) {
      await response.body?.cancel().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      continue;
    }
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const code = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' && /^[a-z_]{1,64}$/u.test(body.error) ? body.error : undefined;
      throw new DiscordApiError(response.status, endpoint, code);
    }
    return schema.parse(response.status === 204 ? undefined : await response.json());
  }
}
function request<T>(url: string, init: RequestInit, schema: z.ZodType<T>, options: DiscordRequestOptions = {}): Promise<T> {
  if (init.method && init.method !== 'GET') return queuedRequest(url, init, schema, options);
  const key = `${new Headers(init.headers).get('authorization') ?? ''}:${url}`;
  const pending = pendingGets.get(key);
  if (pending) {
    if (options.priority === 'interactive') {
      const call = routeQueues.get(rateLimitKey(url, init).route)?.calls.find((queued) => queued.url === url);
      if (call) call.priority = 'interactive';
    }
    return pending as Promise<T>;
  }
  const result = queuedRequest(url, init, schema, options);
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
export function canManageGuild(guild: Pick<DiscordGuild, 'owner' | 'permissions'>) { const bits = BigInt(guild.permissions); return guild.owner || (bits & (1n << 5n)) !== 0n || (bits & (1n << 3n)) !== 0n; }

const memberSchema = z.object({ roles: z.array(z.string()) });
const guildMemberSchema = memberSchema.extend({
  user: discordUserSchema.extend({ bot: z.boolean().optional(), discriminator: z.string().regex(/^\d{1,4}$/).optional() }),
  nick: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
});
export type BotGuildMember = z.infer<typeof guildMemberSchema>;
export function memberDisplayName(member: BotGuildMember): string { return member.nick || member.user.global_name || member.user.username; }
export function memberAvatarUrl(guildId: string, member: BotGuildMember): string {
  const userId = member.user.id;
  if (member.avatar) return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${member.avatar}.webp?size=64`;
  if (member.user.avatar) return `https://cdn.discordapp.com/avatars/${userId}/${member.user.avatar}.webp?size=64`;
  const legacy = member.user.discriminator && member.user.discriminator !== '0';
  const index = legacy ? Number(member.user.discriminator) % 5 : Number((BigInt(userId) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}
export function directoryMember(guildId: string, member: BotGuildMember): DirectoryMember {
  return { id: member.user.id, username: member.user.username, globalName: member.user.global_name ?? null, nick: member.nick ?? null, avatarUrl: memberAvatarUrl(guildId, member), roleIds: member.roles };
}
const guildSchema = z.object({ id: z.string(), owner_id: z.string(), name: z.string(), icon: z.string().nullable() });
export function botGuild(botToken: string, guildId: string, options?: DiscordRequestOptions) { return request(`${api}/guilds/${guildId}`, { headers: { authorization: `Bot ${botToken}` } }, guildSchema, options); }
export function currentGuildMember(accessToken: string, guildId: string) { return request(`${api}/users/@me/guilds/${guildId}/member`, { headers: { authorization: `Bearer ${accessToken}` } }, memberSchema); }

const channelSchema = z.object({ id: z.string(), guild_id: z.string().optional(), name: z.string().optional(), type: z.number(), parent_id: z.string().nullable().optional(), permission_overwrites: z.array(z.object({ id: z.string(), type: z.number(), allow: z.string(), deny: z.string() })).optional() });
export type BotChannel = z.infer<typeof channelSchema>;
export function botGuildChannels(botToken: string, guildId: string) { return request(`${api}/guilds/${guildId}/channels`, { headers: { authorization: `Bot ${botToken}` } }, z.array(channelSchema)); }
const botRoleSchema = z.object({
  id: snowflakeSchema, name: z.string(), permissions: z.string(), position: z.number().int(),
  color: z.number().int().nonnegative().optional(),
  colors: z.object({ primary_color: z.number().int().nonnegative(), secondary_color: z.number().int().nonnegative().nullable(), tertiary_color: z.number().int().nonnegative().nullable() }).optional(),
  icon: z.string().nullable().optional(), unicode_emoji: z.string().nullable().optional(),
});
export type BotGuildRole = z.infer<typeof botRoleSchema>;
export function canMemberManageGuild(guild: { id: string; owner_id: string }, member: Pick<BotGuildMember, 'user' | 'roles'>, roles: readonly Pick<BotGuildRole, 'id' | 'permissions'>[]): boolean {
  const bits = roles.reduce((permissions, role) => role.id === guild.id || member.roles.includes(role.id) ? permissions | BigInt(role.permissions) : permissions, 0n);
  return canManageGuild({ owner: member.user.id === guild.owner_id, permissions: bits.toString() });
}
export function botGuildRoles(botToken: string, guildId: string) { return request(`${api}/guilds/${snowflakeSchema.parse(guildId)}/roles`, { headers: { authorization: `Bot ${botToken}` } }, z.array(botRoleSchema)); }
export function administratorRoleIds(roles: readonly Pick<BotGuildRole, 'id' | 'permissions'>[]): string[] {
  return roles.filter((role) => (BigInt(role.permissions) & PermissionFlagsBits.Administrator) !== 0n).map((role) => role.id);
}
export function botSelf(botToken: string) { return request(`${api}/users/@me`, { headers: { authorization: `Bot ${botToken}` } }, z.object({ id: z.string() })); }
export async function botPresenceIntentAvailable(botToken: string): Promise<boolean> {
  const application = await request(`${api}/oauth2/applications/@me`, { headers: { authorization: `Bot ${botToken}` } }, z.object({ flags: z.number().int().nonnegative().default(0) }));
  return (application.flags & (ApplicationFlags.GatewayPresence | ApplicationFlags.GatewayPresenceLimited)) !== 0;
}
export function botGuildMember(botToken: string, guildId: string, userId: string, options?: DiscordRequestOptions) { return request(`${api}/guilds/${snowflakeSchema.parse(guildId)}/members/${snowflakeSchema.parse(userId)}`, { headers: { authorization: `Bot ${botToken}` } }, guildMemberSchema, options); }
export function botListGuildMembers(botToken: string, guildId: string, after?: string) {
  const params = new URLSearchParams({ limit: '1000' });
  if (after) params.set('after', snowflakeSchema.parse(after));
  return request(`${api}/guilds/${snowflakeSchema.parse(guildId)}/members?${params}`, { headers: { authorization: `Bot ${botToken}` } }, z.array(guildMemberSchema));
}
export function botSearchGuildMembers(botToken: string, guildId: string, query: string) {
  const search = query.trim();
  if (search.length < 2 || search.length > 50) throw new Error('Invalid member search');
  const params = new URLSearchParams({ query: search, limit: '12' });
  return request(`${api}/guilds/${snowflakeSchema.parse(guildId)}/members/search?${params}`, { headers: { authorization: `Bot ${botToken}` } }, z.array(guildMemberSchema));
}
export function botVoiceRegions(botToken: string) { return request(`${api}/voice/regions`, { headers: { authorization: `Bot ${botToken}` } }, z.array(z.object({ id: z.string(), name: z.string() }))); }
export function botCreateVoiceChannel(botToken: string, guildId: string, name: string, parentId: string | null) {
  return request(`${api}/guilds/${guildId}/channels`, { method: 'POST', headers: { authorization: `Bot ${botToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ name, type: 2, parent_id: parentId }) }, channelSchema);
}
export function botRenameVoiceChannel(botToken: string, channelId: string, name: string) {
  return request(`${api}/channels/${channelId}`, { method: 'PATCH', headers: { authorization: `Bot ${botToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ name }) }, channelSchema);
}
export async function botDeleteChannel(botToken: string, channelId: string): Promise<void> {
  await deleteResource(botToken, `/channels/${snowflakeSchema.parse(channelId)}`);
}
async function deleteResource(botToken: string, path: string): Promise<void> {
  try { await request(`${api}${path}`, { method: 'DELETE', headers: { authorization: `Bot ${botToken}` } }, z.unknown()); }
  catch (error) { if (!(error instanceof DiscordApiError && error.status === 404)) throw error; }
}
export function botCreateVoiceInterfaceMessage(botToken: string, channelId: string) {
  return request(`${api}/channels/${channelId}/messages`, { method: 'POST', headers: { authorization: `Bot ${botToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Керування голосовою кімнатою\nСтвори кімнату через Creator-канал, а потім використовуй кнопки нижче.', components: voicePanelRows() }) }, z.object({ id: z.string(), channel_id: z.string() }));
}
export async function botDeleteVoiceInterfaceMessage(botToken: string, channelId: string, messageId: string): Promise<void> {
  await deleteResource(botToken, `/channels/${snowflakeSchema.parse(channelId)}/messages/${snowflakeSchema.parse(messageId)}`);
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
