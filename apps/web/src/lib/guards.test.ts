import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ accessToken: vi.fn(), sessionUser: vi.fn(), discordUser: vi.fn(), discordGuilds: vi.fn(), currentGuildMember: vi.fn(), botGuildMember: vi.fn(), canManageGuild: vi.fn(), guilds: vi.fn(), accessMappings: vi.fn(), guildGet: vi.fn(), installedGuildIds: vi.fn(), redirect: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('react', () => ({ cache: (fn: unknown) => fn }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@scrt/discord', () => ({
  DiscordApiError: class DiscordApiError extends Error { constructor(readonly status: number) { super(`Discord API failed (${status})`); } },
  discordUser: mocks.discordUser,
  discordGuilds: mocks.discordGuilds, botGuildMember: mocks.botGuildMember, currentGuildMember: mocks.currentGuildMember, canManageGuild: mocks.canManageGuild,
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
    mocks.guilds.mockReturnValue({ get: mocks.guildGet, accessMappings: mocks.accessMappings, installedGuildIds: mocks.installedGuildIds });
    mocks.canManageGuild.mockReturnValue(true);
    mocks.botGuildMember.mockResolvedValue({ user: { id: '12345678901234567' }, roles: ['32345678901234567'] });
    mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
  });

  it('uses live ownership without extra Discord bot or member requests', async () => {
    await expect(requireGuildAccess('22345678901234567', 'voice.view')).resolves.toMatchObject({ user: { username: 'Owner' } });
    expect(mocks.botGuildMember).not.toHaveBeenCalled();
    expect(mocks.currentGuildMember).not.toHaveBeenCalled();
    expect(mocks.accessMappings).not.toHaveBeenCalled();
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
    expect(mocks.botGuildMember).toHaveBeenCalledWith('bot-token', guild.id, '12345678901234567');
  });
  it('returns the installed IDs from the same lookup used to authorize the server list', async () => {
    const guild = { id: '22345678901234567', name: 'Server', icon: null, owner: true, permissions: '0' };
    mocks.discordGuilds.mockResolvedValue([guild]);
    mocks.installedGuildIds.mockResolvedValue(new Set([guild.id]));
    await expect(manageableGuildList()).resolves.toEqual({ list: [guild], installedIds: new Set([guild.id]) });
    expect(mocks.installedGuildIds).toHaveBeenCalledTimes(1);
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
  it('passes personal access into the server guard without requesting roles', async () => {
    mocks.discordGuilds.mockResolvedValue([{ id: '22345678901234567', name: 'Server', icon: null, owner: false, permissions: '0' }]);
    mocks.accessMappings.mockResolvedValue({ roles: [], members: [{ discordUserId: '12345678901234567', appRole: 'ADMIN' }] });
    const result = await requireGuildAccess('22345678901234567', 'voice.manage');
    expect(result.permissions.has('voice.manage')).toBe(true);
    expect(result.permissions.has('settings.manage')).toBe(false);
    expect(mocks.botGuildMember).not.toHaveBeenCalled();
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
    expect(mocks.botGuildMember).toHaveBeenCalledWith('bot-token', guild.id, userId);
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
    mocks.discordGuilds.mockResolvedValue([]);
    mocks.accessMappings.mockResolvedValue({ roles: [], members: [{ discordUserId: userId, appRole: 'ADMIN' }] });
    await expect(requireGuildAccess(guild.id)).rejects.toThrow('Forbidden');
    expect(mocks.botGuildMember).not.toHaveBeenCalled();
  });

  it.each([401, 429, 503])('fails closed on bot API %i without refreshing the OAuth session', async (status) => {
    mocks.botGuildMember.mockRejectedValue(new DiscordApiError(status));
    await expect(requireGuildAccess(guild.id, 'voice.manage')).rejects.toMatchObject({ status });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.currentGuildMember).not.toHaveBeenCalled();
  });
});
