import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ accessToken: vi.fn(), requireGuildAccess: vi.fn(), revision: vi.fn(), mappings: vi.fn(), list: vi.fn() }));
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
const roleId = '223456789012345678';
const context = { params: Promise.resolve({ guildId }) };
const request = () => new Request(`http://localhost/api/guilds/${guildId}/members/snapshot`);
const raw = (id: string, roles: string[]) => ({ user: { id, username: id }, roles });

describe('member snapshot stream', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.accessToken.mockResolvedValue('token');
    mocks.revision.mockResolvedValue(7);
    mocks.mappings.mockResolvedValue({ roles: [{ discordRoleId: roleId, appRole: 'VIEWER' }], members: [] });
    mocks.list.mockResolvedValue([raw('323456789012345678', [roleId]), raw('423456789012345678', [])]);
  });

  it('returns only mapped role members to a viewer in one authorized stream', async () => {
    mocks.requireGuildAccess.mockResolvedValue({ permissions: new Set(['settings.view']) });
    const response = await GET(request(), context);
    const lines = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    expect(lines[0].members.map((member: { id: string }) => member.id)).toEqual(['323456789012345678']);
    expect(lines[1]).toEqual({ kind: 'done', revision: 7 });
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.requireGuildAccess).toHaveBeenCalledWith(guildId, 'settings.view');
  });

  it('returns a full roster to settings managers without loading access mappings', async () => {
    mocks.requireGuildAccess.mockResolvedValue({ permissions: new Set(['settings.view', 'settings.manage']) });
    const response = await GET(request(), context);
    const lines = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    expect(lines[0].members).toHaveLength(2);
    expect(mocks.mappings).not.toHaveBeenCalled();
  });
  it('includes all human members for an @everyone viewer', async () => {
    mocks.requireGuildAccess.mockResolvedValue({ permissions: new Set(['settings.view']) });
    mocks.mappings.mockResolvedValue({ roles: [{ discordRoleId: guildId, appRole: 'VIEWER' }], members: [] });
    const response = await GET(request(), context);
    const lines = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    expect(lines[0].members.map((member: { id: string }) => member.id)).toEqual(['323456789012345678', '423456789012345678']);
    expect(lines[0].members.every((member: { roleIds: string[] }) => member.roleIds.includes(guildId))).toBe(true);
  });

  it('does not start a stream for a forbidden user', async () => {
    mocks.requireGuildAccess.mockRejectedValue(new Error('Forbidden'));
    expect((await GET(request(), context)).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('fetches pages only as they are consumed and stops on cancellation', async () => {
    mocks.requireGuildAccess.mockResolvedValue({ permissions: new Set(['settings.view', 'settings.manage']) });
    const first = Array.from({ length: 1000 }, (_, i) => raw(String(323456789012345678n + BigInt(i)), []));
    mocks.list.mockResolvedValueOnce(first).mockResolvedValueOnce([raw('423456789012345678', [])]);
    const response = await GET(request(), context);
    expect(mocks.list).not.toHaveBeenCalled();
    const reader = response.body!.getReader();
    await reader.read();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.list).toHaveBeenCalledTimes(1);
    await reader.cancel();
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it('uses the Discord cursor for the next page and excludes bots', async () => {
    mocks.requireGuildAccess.mockResolvedValue({ permissions: new Set(['settings.view', 'settings.manage']) });
    const first = Array.from({ length: 1000 }, (_, i) => raw(String(323456789012345678n + BigInt(i)), []));
    mocks.list.mockResolvedValueOnce(first).mockResolvedValueOnce([{ ...raw('423456789012345678', []), user: { id: '423456789012345678', username: 'bot', bot: true } }]);
    const response = await GET(request(), context);
    const lines = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    expect(lines[0].members).toHaveLength(1000);
    expect(lines[1].members).toEqual([]);
    expect(lines[2]).toEqual({ kind: 'done', revision: 7 });
    expect(mocks.list).toHaveBeenNthCalledWith(2, 'token', guildId, 7, first.at(-1)?.user.id);
  });
});
