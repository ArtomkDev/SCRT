import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ accessToken: vi.fn(), sessionUser: vi.fn(), discordUser: vi.fn(), discordGuilds: vi.fn(), currentGuildMember: vi.fn(), botGuild: vi.fn(), botGuildMember: vi.fn(), canManageGuild: vi.fn(), guilds: vi.fn(), accessMappings: vi.fn(), guildGet: vi.fn(), installedGuildIds: vi.fn(), redirect: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('react', () => ({ cache: (fn: unknown) => fn }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@scrt/discord', () => ({
  DiscordApiError: class DiscordApiError extends Error { constructor(readonly status: number) { super(`Discord API failed (${status})`); } },
  discordUser: mocks.discordUser,
  discordGuilds: mocks.discordGuilds, botGuild: mocks.botGuild, botGuildMember: mocks.botGuildMember, currentGuildMember: mocks.currentGuildMember, canManageGuild: mocks.canManageGuild,
}));
vi.mock('./session', () => ({ accessToken: mocks.accessToken, sessionUser: mocks.sessionUser }));
vi.mock('./server', () => ({ guilds: mocks.guilds, env: () => ({ DISCORD_BOT_TOKEN: 'bot-token' }) }));
vi.mock('@scrt/validation', () => ({ guildIdSchema: { parse: (value: string) => value } }));

import { DiscordApiError } from '@scrt/discord';
import { manageableGuildList, manageableGuilds, requireGuildAccess, requireSession } from './guards';

describe('session guard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.accessToken.mockResolvedValue('stale-token');
    mocks.sessionUser.mockResolvedValue(null);
    mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
  });

  it('forces a refresh when Discord revokes an unexpired token', async () => {
    mocks.discordUser.mockRejectedValue(new DiscordApiError(401));
    await expect(requireSession('/dashboard')).rejects.toThrow('redirect:/api/auth/refresh?force=1&next=%2Fdashboard');
  });

  it('does not treat another Discord error as an expired session', async () => {
    mocks.discordUser.mockRejectedValue(new DiscordApiError(503));
    await expect(requireSession()).rejects.toMatchObject({ status: 503 });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('uses the profile already stored in the encrypted session', async () => {
    const user = { id: '12345678901234567', username: 'Tester' };
    mocks.sessionUser.mockResolvedValue(user);
    await expect(requireSession()).resolves.toMatchObject({ user });
    expect(mocks.discordUser).not.toHaveBeenCalled();
  });
});

describe('guild access guard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.accessToken.mockResolvedValue('live-token');
    mocks.sessionUser.mockResolvedValue({ id: '12345678901234567', username: 'Owner' });
    mocks.discordGuilds.mockResolvedValue([{ id: '22345678901234567', name: 'Server', icon: null, owner: true, permissions: '0' }]);
    mocks.guildGet.mockResolvedValue({ guildId: '22345678901234567', botInstalled: true });
    mocks.botGuild.mockResolvedValue({ id: '22345678901234567', name: 'Server', icon: null, owner_id: '42345678901234567' });
    mocks.accessMappings.mockResolvedValue({ roles: [], members: [] });
    mocks.guilds.mockReturnValue({ get: mocks.guildGet, accessMappings: mocks.accessMappings, installedGuildIds: mocks.installedGuildIds });
    mocks.canManageGuild.mockReturnValue(true);
    mocks.botGuildMember.mockResolvedValue({ user: { id: '12345678901234567' }, roles: ['32345678901234567'] });
    mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
  });

  it('uses targeted live ownership and membership without the OAuth guild list', async () => {
    mocks.botGuild.mockResolvedValue({ id: '22345678901234567', name: 'Server', icon: null, owner_id: '12345678901234567' });
    await expect(requireGuildAccess('22345678901234567', 'voice.view')).resolves.toMatchObject({ user: { username: 'Owner' } });
    expect(mocks.botGuildMember).toHaveBeenCalledTimes(1);
    expect(mocks.currentGuildMember).not.toHaveBeenCalled();
    expect(mocks.discordGuilds).not.toHaveBeenCalled();
  });

  it('does not treat Manage Guild as SCRT access on an installed server', async () => {
    mocks.discordGuilds.mockResolvedValue([{ id: '22345678901234567', name: 'Server', icon: null, owner: false, permissions: '32' }]);
    mocks.installedGuildIds.mockResolvedValue(new Set(['22345678901234567']));
    mocks.accessMappings.mockResolvedValue({ roles: [], members: [] });
    await expect(manageableGuilds()).resolves.toEqual([]);
    expect(mocks.currentGuildMember).not.toHaveBeenCalled();
  });

  it('shows installed servers to mapped role members', async () => {
    const guild = { id: '22345678901234567', name: 'Server', icon: null, owner: false, permissions: '0' };
    mocks.discordGuilds.mockResolvedValue([guild]);
    mocks.installedGuildIds.mockResolvedValue(new Set([guild.id]));
    mocks.accessMappings.mockResolvedValue({ roles: [{ discordRoleId: '32345678901234567', appRole: 'ADMIN' }], members: [] });
    await expect(manageableGuilds()).resolves.toEqual([guild]);
    expect(mocks.botGuildMember).toHaveBeenCalledWith('bot-token', guild.id, '12345678901234567', { priority: 'interactive' });
  });
  it('returns the installed IDs from the same lookup used to authorize the server list', async () => {
    const guild = { id: '22345678901234567', name: 'Server', icon: null, owner: true, permissions: '0' };
    mocks.discordGuilds.mockResolvedValue([guild]);
    mocks.installedGuildIds.mockResolvedValue(new Set([guild.id]));
    await expect(manageableGuildList()).resolves.toEqual({ list: [guild], installedIds: new Set([guild.id]) });
    expect(mocks.installedGuildIds).toHaveBeenCalledTimes(1);
  });
  it('never offers installation for a non-manageable uninstalled guild', async () => {
    const guild = { id: '22345678901234567', name: 'Server', icon: null, owner: false, permissions: '0' };
    mocks.discordGuilds.mockResolvedValue([guild]);
    mocks.installedGuildIds.mockResolvedValue(new Set());
    mocks.canManageGuild.mockReturnValue(false);
    await expect(manageableGuildList()).resolves.toEqual({ list: [], installedIds: new Set() });
    expect(mocks.accessMappings).not.toHaveBeenCalled();
    expect(mocks.botGuildMember).not.toHaveBeenCalled();
  });
  it('uses one installed-state batch for many rail items without individual guild reads', async () => {
    const list = Array.from({ length: 100 }, (_, index) => ({ id: String(22345678901234567n + BigInt(index)), name: `Server ${index}`, icon: null, owner: true, permissions: '0' }));
    mocks.discordGuilds.mockResolvedValue(list);
    mocks.installedGuildIds.mockResolvedValue(new Set(list.map((guild) => guild.id)));
    expect((await manageableGuildList()).list).toHaveLength(100);
    expect(mocks.installedGuildIds).toHaveBeenCalledTimes(1);
    expect(mocks.installedGuildIds).toHaveBeenCalledWith(list.map((guild) => guild.id));
    expect(mocks.guildGet).not.toHaveBeenCalled();
    expect(mocks.botGuild).not.toHaveBeenCalled();
    expect(mocks.botGuildMember).not.toHaveBeenCalled();
  });
  it('recognizes an @everyone viewer without fetching individual Discord roles', async () => {
    const guild = { id: '22345678901234567', name: 'Server', icon: null, owner: false, permissions: '0' };
    mocks.discordGuilds.mockResolvedValue([guild]);
    mocks.installedGuildIds.mockResolvedValue(new Set([guild.id]));
    mocks.accessMappings.mockResolvedValue({ roles: [{ discordRoleId: guild.id, appRole: 'VIEWER' }], members: [] });
    await expect(manageableGuilds()).resolves.toEqual([guild]);
    expect(mocks.botGuildMember).not.toHaveBeenCalled();
    expect(mocks.currentGuildMember).not.toHaveBeenCalled();
  });
  it('shows an installed server to a selected member without fetching roles', async () => {
    const guild = { id: '22345678901234567', name: 'Server', icon: null, owner: false, permissions: '0' };
    mocks.discordGuilds.mockResolvedValue([guild]);
    mocks.installedGuildIds.mockResolvedValue(new Set([guild.id]));
    mocks.accessMappings.mockResolvedValue({ roles: [], members: [{ discordUserId: '12345678901234567', appRole: 'ADMIN' }] });
    await expect(manageableGuilds()).resolves.toEqual([guild]);
    expect(mocks.botGuildMember).not.toHaveBeenCalled();
    expect(mocks.currentGuildMember).not.toHaveBeenCalled();
  });
  it('passes personal access into the server guard after targeted membership verification', async () => {
    mocks.discordGuilds.mockResolvedValue([{ id: '22345678901234567', name: 'Server', icon: null, owner: false, permissions: '0' }]);
    mocks.accessMappings.mockResolvedValue({ roles: [], members: [{ discordUserId: '12345678901234567', appRole: 'ADMIN' }] });
    const result = await requireGuildAccess('22345678901234567', 'voice.manage');
    expect(result.permissions.has('voice.manage')).toBe(true);
    expect(result.permissions.has('settings.manage')).toBe(false);
    expect(mocks.botGuildMember).toHaveBeenCalledTimes(1);
    expect(mocks.currentGuildMember).not.toHaveBeenCalled();
  });
});

describe('guild access during an OAuth member rate limit', () => {
  const guild = { id: '22345678901234567', name: 'Server', icon: null, owner: false, permissions: '0' };
  const userId = '12345678901234567';
  const roleId = '32345678901234567';

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.accessToken.mockResolvedValue('live-token');
    mocks.sessionUser.mockResolvedValue({ id: userId, username: 'Member' });
    mocks.discordGuilds.mockResolvedValue([guild]);
    mocks.guildGet.mockResolvedValue({ guildId: guild.id, botInstalled: true });
    mocks.botGuild.mockResolvedValue({ id: guild.id, name: guild.name, icon: null, owner_id: '42345678901234567' });
    mocks.installedGuildIds.mockResolvedValue(new Set([guild.id]));
    mocks.guilds.mockReturnValue({ get: mocks.guildGet, accessMappings: mocks.accessMappings, installedGuildIds: mocks.installedGuildIds });
    mocks.accessMappings.mockResolvedValue({ roles: [{ discordRoleId: roleId, appRole: 'ADMIN' }], members: [] });
    mocks.botGuildMember.mockResolvedValue({ user: { id: userId }, roles: [roleId] });
    mocks.currentGuildMember.mockRejectedValue(new DiscordApiError(429));
    mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
  });

  it('loads role-only servers and settings without the rate-limited OAuth member endpoint', async () => {
    await expect(manageableGuilds()).resolves.toEqual([guild]);
    const result = await requireGuildAccess(guild.id, 'settings.view');
    expect(result.permissions.has('voice.manage')).toBe(true);
    expect(result.permissions.has('settings.manage')).toBe(false);
    expect(mocks.botGuildMember).toHaveBeenCalledWith('bot-token', guild.id, userId, { priority: 'interactive' });
    expect(mocks.currentGuildMember).not.toHaveBeenCalled();
  });

  it('skips member lookups for @everyone access even when admin mappings also exist', async () => {
    mocks.accessMappings.mockResolvedValue({ roles: [{ discordRoleId: guild.id, appRole: 'VIEWER' }, { discordRoleId: roleId, appRole: 'ADMIN' }], members: [] });
    mocks.botGuildMember.mockRejectedValue(new DiscordApiError(429));
    await expect(manageableGuilds()).resolves.toEqual([guild]);
    expect(mocks.botGuildMember).not.toHaveBeenCalled();
    expect(mocks.currentGuildMember).not.toHaveBeenCalled();
  });

  it('skips member lookups for personal access alongside unrelated role mappings', async () => {
    mocks.accessMappings.mockResolvedValue({ roles: [{ discordRoleId: roleId, appRole: 'ADMIN' }], members: [{ discordUserId: userId, appRole: 'VIEWER' }] });
    await expect(manageableGuilds()).resolves.toEqual([guild]);
    expect(mocks.botGuildMember).not.toHaveBeenCalled();
  });

  it('still resolves elevated page permissions when @everyone already grants read access', async () => {
    mocks.accessMappings.mockResolvedValue({ roles: [{ discordRoleId: guild.id, appRole: 'VIEWER' }, { discordRoleId: roleId, appRole: 'ADMIN' }], members: [] });
    const result = await requireGuildAccess(guild.id, 'settings.view');
    expect(result.permissions.has('voice.manage')).toBe(true);
    expect(mocks.botGuildMember).toHaveBeenCalledTimes(1);
  });

  it('rejects revoked roles on the next request instead of reusing directory/profile caches', async () => {
    await expect(requireGuildAccess(guild.id, 'voice.manage')).resolves.toBeDefined();
    mocks.botGuildMember.mockResolvedValue({ user: { id: userId }, roles: [] });
    await expect(requireGuildAccess(guild.id, 'voice.manage')).rejects.toThrow('Forbidden');
    await expect(manageableGuilds()).resolves.toEqual([]);
  });

  it('excludes a departed role member and rejects direct page access', async () => {
    mocks.botGuildMember.mockRejectedValue(new DiscordApiError(404));
    await expect(manageableGuilds()).resolves.toEqual([]);
    await expect(requireGuildAccess(guild.id)).rejects.toThrow('Forbidden');
  });

  it('cannot use a role mapping from another user or grant access on an unexpected member response', async () => {
    mocks.botGuildMember.mockResolvedValue({ user: { id: '42345678901234567' }, roles: [roleId] });
    await expect(requireGuildAccess(guild.id)).rejects.toThrow('Forbidden');
  });

  it('checks live guild membership before granting personal access', async () => {
    mocks.botGuildMember.mockRejectedValue(new DiscordApiError(404));
    mocks.accessMappings.mockResolvedValue({ roles: [], members: [{ discordUserId: userId, appRole: 'ADMIN' }] });
    await expect(requireGuildAccess(guild.id)).rejects.toThrow('Forbidden');
    expect(mocks.discordGuilds).not.toHaveBeenCalled();
  });

  it('loads pages when the unrelated OAuth guild-list endpoint is rate limited', async () => {
    mocks.discordGuilds.mockRejectedValue(new DiscordApiError(429));
    await expect(requireGuildAccess(guild.id, 'voice.manage')).resolves.toBeDefined();
    expect(mocks.discordGuilds).not.toHaveBeenCalled();
  });

  it('starts live ownership, membership and mapping reads together', async () => {
    let resolveGuild!: (value: unknown) => void;
    mocks.botGuild.mockReturnValue(new Promise((resolve) => { resolveGuild = resolve; }));
    const pending = requireGuildAccess(guild.id, 'voice.manage');
    await vi.waitFor(() => {
      expect(mocks.botGuildMember).toHaveBeenCalledTimes(1);
      expect(mocks.accessMappings).toHaveBeenCalledTimes(1);
      expect(mocks.guildGet).toHaveBeenCalledTimes(1);
    });
    resolveGuild({ id: guild.id, name: guild.name, icon: null, owner_id: '42345678901234567' });
    await expect(pending).resolves.toBeDefined();
  });

  it('rejects stale ownership after a live owner transfer', async () => {
    mocks.botGuild.mockResolvedValue({ id: guild.id, name: guild.name, icon: null, owner_id: userId });
    await expect(requireGuildAccess(guild.id, 'settings.manage')).resolves.toBeDefined();
    mocks.botGuild.mockResolvedValue({ id: guild.id, name: guild.name, icon: null, owner_id: '42345678901234567' });
    await expect(requireGuildAccess(guild.id, 'settings.manage')).rejects.toThrow('Forbidden');
  });

  it('rejects a guild response belonging to another server', async () => {
    mocks.botGuild.mockResolvedValue({ id: '52345678901234567', name: guild.name, icon: null, owner_id: userId });
    await expect(requireGuildAccess(guild.id)).rejects.toThrow('Forbidden');
  });

  it('rejects a removed bot even if Firestore still records an installation', async () => {
    mocks.botGuild.mockRejectedValue(new DiscordApiError(404));
    await expect(requireGuildAccess(guild.id)).rejects.toThrow('Bot not installed');
  });

  it.each([401, 429, 503])('fails closed on bot API %i without refreshing the OAuth session', async (status) => {
    mocks.botGuildMember.mockRejectedValue(new DiscordApiError(status));
    await expect(requireGuildAccess(guild.id, 'voice.manage')).rejects.toMatchObject({ status });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.currentGuildMember).not.toHaveBeenCalled();
  });
});
