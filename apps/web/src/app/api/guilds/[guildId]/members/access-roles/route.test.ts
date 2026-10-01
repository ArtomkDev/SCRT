import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ accessToken: vi.fn(), requireGuildAccess: vi.fn(), list: vi.fn(), revision: vi.fn(), mappings: vi.fn() }));
vi.mock('@/lib/session', () => ({ accessToken: mocks.accessToken }));
vi.mock('@/lib/guards', () => ({ requireGuildAccess: mocks.requireGuildAccess }));
vi.mock('@/lib/server', () => ({ env: () => ({ DISCORD_BOT_TOKEN: 'token' }), guilds: () => ({ memberDirectoryRevision: mocks.revision, accessMappings: mocks.mappings }) }));
vi.mock('@/lib/member-directory-cache', () => ({ cachedGuildMemberPage: mocks.list }));
vi.mock('@/lib/member-directory-scope', async () => ({ accessRoleMember: (await import('../../../../../../lib/member-directory-scope')).accessRoleMember }));
vi.mock('@scrt/discord', () => ({
  directoryMember: (_guildId: string, value: { user: { id: string; username: string }; roles: string[] }) => ({ id: value.user.id, username: value.user.username, globalName: null, nick: null, avatarUrl: 'https://cdn.discordapp.com/a.png', roleIds: value.roles }),
  DiscordApiError: class DiscordApiError extends Error { status = 403; },
}));

import { GET } from './route';

const guildId = '123456789012345678';
const mappedRole = '223456789012345678';
const otherRole = '323456789012345678';
const context = { params: Promise.resolve({ guildId }) };
const request = new Request(`http://localhost/api/guilds/${guildId}/members/access-roles`);

describe('scoped access-role members', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accessToken.mockResolvedValue('token');
    mocks.requireGuildAccess.mockResolvedValue({ permissions: new Set(['settings.view']) });
    mocks.revision.mockResolvedValue(4);
    mocks.mappings.mockResolvedValue({ roles: [{ discordRoleId: mappedRole, appRole: 'VIEWER' }], members: [] });
  });

  it('returns only members of configured access roles and only their mapped roles', async () => {
    mocks.list.mockResolvedValue([
      { user: { id: '423456789012345678', username: 'allowed' }, roles: [mappedRole, otherRole] },
      { user: { id: '523456789012345678', username: 'private' }, roles: [otherRole] },
    ]);
    const response = await GET(request, context);
    const data = await response.json();
    expect(data.members).toEqual([{ id: '423456789012345678', username: 'allowed', globalName: null, nick: null, avatarUrl: 'https://cdn.discordapp.com/a.png', roleIds: [mappedRole] }]);
    expect(mocks.requireGuildAccess).toHaveBeenCalledWith(guildId, 'settings.view');
  });

  it('does not read the roster for unauthenticated or forbidden users', async () => {
    mocks.accessToken.mockResolvedValueOnce(null);
    expect((await GET(request, context)).status).toBe(401);
    mocks.requireGuildAccess.mockRejectedValueOnce(new Error('Forbidden'));
    expect((await GET(request, context)).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
