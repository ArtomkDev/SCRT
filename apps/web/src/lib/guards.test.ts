import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ accessToken: vi.fn(), sessionUser: vi.fn(), discordUser: vi.fn(), discordGuilds: vi.fn(), currentGuildMember: vi.fn(), botGuild: vi.fn(), canManageGuild: vi.fn(), guilds: vi.fn(), roleMappings: vi.fn(), guildGet: vi.fn(), requirePermission: vi.fn(), permissionsFor: vi.fn(), redirect: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('react', () => ({ cache: (fn: unknown) => fn }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@scrt/discord', () => ({
  DiscordApiError: class DiscordApiError extends Error { constructor(readonly status: number) { super(`Discord API failed (${status})`); } },
  discordUser: mocks.discordUser,
  discordGuilds: mocks.discordGuilds, botGuild: mocks.botGuild, currentGuildMember: mocks.currentGuildMember, canManageGuild: mocks.canManageGuild,
}));
vi.mock('./session', () => ({ accessToken: mocks.accessToken, sessionUser: mocks.sessionUser }));
vi.mock('./server', () => ({ guilds: mocks.guilds }));
vi.mock('@scrt/permissions', () => ({ PermissionService: class { require = mocks.requirePermission; permissionsFor = mocks.permissionsFor; } }));
vi.mock('@scrt/validation', () => ({ guildIdSchema: { parse: (value: string) => value } }));

import { DiscordApiError } from '@scrt/discord';
import { requireGuildAccess, requireSession } from './guards';

describe('session guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    vi.clearAllMocks();
    mocks.accessToken.mockResolvedValue('live-token');
    mocks.sessionUser.mockResolvedValue({ id: '12345678901234567', username: 'Owner' });
    mocks.discordGuilds.mockResolvedValue([{ id: '22345678901234567', name: 'Server', icon: null, owner: true, permissions: '0' }]);
    mocks.guildGet.mockResolvedValue({ guildId: '22345678901234567', botInstalled: true });
    mocks.guilds.mockReturnValue({ get: mocks.guildGet, roleMappings: mocks.roleMappings });
    mocks.canManageGuild.mockReturnValue(true);
    mocks.permissionsFor.mockReturnValue(new Set(['dashboard.access', 'voice.view']));
  });

  it('uses live ownership without extra Discord bot or member requests', async () => {
    await expect(requireGuildAccess('22345678901234567', 'voice.view')).resolves.toMatchObject({ user: { username: 'Owner' } });
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.objectContaining({ ownerId: '12345678901234567' }), 'voice.view');
    expect(mocks.botGuild).not.toHaveBeenCalled();
    expect(mocks.currentGuildMember).not.toHaveBeenCalled();
    expect(mocks.roleMappings).not.toHaveBeenCalled();
  });
});
