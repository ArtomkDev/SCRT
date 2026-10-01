import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const guildId = '223456789012345678';
const userId = '323456789012345678';
const state = 'a'.repeat(43);
const verifier = 'b'.repeat(43);
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ cookies: vi.fn(), exchangeCode: vi.fn(), discordUser: vi.fn(), sessionUser: vi.fn(), botGuild: vi.fn(), botGuildMember: vi.fn(), botGuildRoles: vi.fn(), canMemberManageGuild: vi.fn(), administratorRoleIds: vi.fn(), upsertInstalled: vi.fn(), grantInstallerAccess: vi.fn(), createSession: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/lib/session', () => ({ createSession: mocks.createSession, sessionUser: mocks.sessionUser }));
vi.mock('@/lib/server', () => ({
  appUrl: () => new URL('https://scrt.example'), callbackUrl: () => 'https://scrt.example/api/auth/callback',
  env: () => ({ DISCORD_CLIENT_ID: '123456789012345678', DISCORD_CLIENT_SECRET: 'secret', DISCORD_BOT_TOKEN: 'bot-token', SESSION_SECRET: 'installation-test-secret' }),
  guilds: () => ({ upsertInstalled: mocks.upsertInstalled, grantInstallerAccess: mocks.grantInstallerAccess }),
}));
vi.mock('@scrt/discord', () => ({ exchangeCode: mocks.exchangeCode, discordUser: mocks.discordUser, botGuild: mocks.botGuild, botGuildMember: mocks.botGuildMember, botGuildRoles: mocks.botGuildRoles, canMemberManageGuild: mocks.canMemberManageGuild, administratorRoleIds: mocks.administratorRoleIds }));

import { GET } from './route';
import { signInstallationState } from '@/lib/installation-state';

const request = (returnedGuildId = guildId) => new NextRequest(`https://scrt.example/api/auth/callback?state=${state}&code=authorization-code&guild_id=${returnedGuildId}`);

describe('installer callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.cookies.mockResolvedValue({
      get: (name: string) => name === 'scrt_install' ? { value: signInstallationState({ state, verifier, guildId, userId }) } : undefined,
      delete: vi.fn(),
    });
    mocks.exchangeCode.mockResolvedValue({ access_token: 'authorized-user-token' });
    mocks.discordUser.mockResolvedValue({ id: userId });
    mocks.sessionUser.mockResolvedValue({ id: userId });
    mocks.botGuild.mockResolvedValue({ id: guildId, name: 'Server', icon: null, owner_id: '523456789012345678' });
    mocks.botGuildMember.mockResolvedValue({ user: { id: userId, bot: false } });
    mocks.botGuildRoles.mockResolvedValue([{ id: '423456789012345678', permissions: '8' }]);
    mocks.administratorRoleIds.mockReturnValue(['423456789012345678']);
    mocks.canMemberManageGuild.mockReturnValue(true);
  });

  it('grants the verified installer access to the selected server', async () => {
    const response = await GET(request());
    expect(response.headers.get('location')).toBe(`https://scrt.example/servers/${guildId}/settings/access-control`);
    expect(mocks.upsertInstalled).toHaveBeenCalledWith({ guildId, name: 'Server', icon: null, ownerId: '523456789012345678' }, ['423456789012345678']);
    expect(mocks.grantInstallerAccess).toHaveBeenCalledWith(guildId, userId, ['423456789012345678'], '523456789012345678');
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('passes live ownership to installation defaults when the owner installs the bot', async () => {
    mocks.botGuild.mockResolvedValue({ id: guildId, name: 'Server', icon: null, owner_id: userId });
    expect((await GET(request())).headers.get('location')).toBe(`https://scrt.example/servers/${guildId}/settings/access-control`);
    expect(mocks.grantInstallerAccess).toHaveBeenCalledWith(guildId, userId, ['423456789012345678'], userId);
  });

  it('rejects an authorization for another guild', async () => {
    const response = await GET(request('523456789012345678'));
    expect(response.headers.get('location')).toBe('https://scrt.example/servers?install=failed');
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
    expect(mocks.grantInstallerAccess).not.toHaveBeenCalled();
  });

  it('rejects a client-fabricated unsigned installation cookie', async () => {
    mocks.cookies.mockResolvedValue({
      get: (name: string) => name === 'scrt_install' ? { value: JSON.stringify({ state, verifier, guildId, userId }) } : undefined,
      delete: vi.fn(),
    });
    expect((await GET(request())).headers.get('location')).toBe('https://scrt.example/?error=oauth_state');
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
    expect(mocks.grantInstallerAccess).not.toHaveBeenCalled();
  });

  it('does not grant installation access to an ordinary member with a valid OAuth identity', async () => {
    mocks.canMemberManageGuild.mockReturnValue(false);
    expect((await GET(request())).headers.get('location')).toBe('https://scrt.example/servers?install=failed');
    expect(mocks.upsertInstalled).not.toHaveBeenCalled();
    expect(mocks.grantInstallerAccess).not.toHaveBeenCalled();
  });

  it('rejects a different Discord user or a missing current session', async () => {
    mocks.discordUser.mockResolvedValueOnce({ id: '623456789012345678' });
    expect((await GET(request())).headers.get('location')).toBe('https://scrt.example/servers?install=failed');
    mocks.sessionUser.mockResolvedValueOnce(null);
    expect((await GET(request())).headers.get('location')).toBe('https://scrt.example/servers?install=failed');
    expect(mocks.grantInstallerAccess).not.toHaveBeenCalled();
  });
  it('rejects a forged state or a user who is not the guild member', async () => {
    const forged = new NextRequest(`https://scrt.example/api/auth/callback?state=${'x'.repeat(43)}&code=authorization-code&guild_id=${guildId}`);
    expect((await GET(forged)).headers.get('location')).toBe('https://scrt.example/?error=oauth_state');
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
    mocks.botGuildMember.mockResolvedValueOnce({ user: { id: '623456789012345678', bot: false } });
    expect((await GET(request())).headers.get('location')).toBe('https://scrt.example/servers?install=failed');
    expect(mocks.grantInstallerAccess).not.toHaveBeenCalled();
  });
});
