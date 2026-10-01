import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), discordGuilds: vi.fn(), canManageGuild: vi.fn(), installAuthorizationUrl: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/guards', () => ({ requireSession: mocks.requireSession }));
vi.mock('@/lib/session', () => ({ cookieOptions: () => ({ httpOnly: true, sameSite: 'lax', path: '/' }) }));
vi.mock('@/lib/server', () => ({
  appUrl: () => new URL('https://scrt.example'), callbackUrl: () => 'https://scrt.example/api/auth/callback',
  env: () => ({ DISCORD_CLIENT_ID: '123456789012345678', SESSION_SECRET: 'installation-test-secret' }), guilds: () => ({ get: mocks.get }),
}));
vi.mock('@scrt/discord', () => ({ discordGuilds: mocks.discordGuilds, canManageGuild: mocks.canManageGuild, installAuthorizationUrl: mocks.installAuthorizationUrl }));

import { GET } from './route';

const guildId = '223456789012345678';
const context = { params: Promise.resolve({ guildId }) };
const request = new Request(`https://scrt.example/api/install/${guildId}`);

describe('bot installation start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ token: 'user-token', user: { id: '323456789012345678' } });
    mocks.discordGuilds.mockResolvedValue([{ id: guildId, owner: false, permissions: '32' }]);
    mocks.canManageGuild.mockReturnValue(true);
    mocks.get.mockResolvedValue(null);
    mocks.installAuthorizationUrl.mockReturnValue('https://discord.com/oauth2/authorize?flow=install');
  });

  it('starts a state-bound authorization only for a manageable guild', async () => {
    const response = await GET(request, context);
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('discord.com/oauth2/authorize');
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('scrt_install=');
    expect(cookie).toContain('HttpOnly');
    expect(mocks.installAuthorizationUrl).toHaveBeenCalledWith('123456789012345678', guildId, 'https://scrt.example/api/auth/callback', expect.any(String), expect.any(String));
  });

  it('rejects a guild the user cannot manage', async () => {
    mocks.canManageGuild.mockReturnValue(false);
    expect((await GET(request, context)).status).toBe(403);
    expect(mocks.installAuthorizationUrl).not.toHaveBeenCalled();
  });

  it('does not offer a new installer grant for an already installed bot', async () => {
    mocks.get.mockResolvedValue({ botInstalled: true });
    const response = await GET(request, context);
    expect(response.headers.get('location')).toBe(`https://scrt.example/servers/${guildId}`);
    expect(mocks.installAuthorizationUrl).not.toHaveBeenCalled();
  });
});
