import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ accessToken: vi.fn(), requireGuildAccess: vi.fn(), list: vi.fn(), revision: vi.fn(), search: vi.fn(), member: vi.fn() }));
vi.mock('@/lib/session', () => ({ accessToken: mocks.accessToken }));
vi.mock('@/lib/guards', () => ({ requireGuildAccess: mocks.requireGuildAccess }));
vi.mock('@/lib/server', () => ({ env: () => ({ DISCORD_BOT_TOKEN: 'token' }), guilds: () => ({ memberDirectoryRevision: mocks.revision }) }));
vi.mock('@/lib/member-directory-cache', () => ({ cachedGuildMemberPage: mocks.list }));
vi.mock('@scrt/discord', () => ({
  botListGuildMembers: mocks.list,
  botSearchGuildMembers: mocks.search,
  botGuildMember: mocks.member,
  directoryMember: (_guildId: string, value: { user: { id: string } }) => ({ id: value.user.id }),
  DiscordApiError: class DiscordApiError extends Error { status = 403; },
}));

import { GET } from './route';

const guildId = '123456789012345678';
const context = { params: Promise.resolve({ guildId }) };
const request = (suffix = '') => new Request(`http://localhost/api/guilds/${guildId}/members${suffix}`);

describe('guild member directory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accessToken.mockResolvedValue('token');
    mocks.requireGuildAccess.mockResolvedValue({ permissions: new Set(['settings.manage']) });
    mocks.revision.mockResolvedValue(3);
    mocks.list.mockResolvedValue([]);
  });

  it('requires a session and settings management permission before reading the full roster', async () => {
    mocks.accessToken.mockResolvedValueOnce(null);
    expect((await GET(request(), context)).status).toBe(401);
    mocks.requireGuildAccess.mockRejectedValueOnce(new Error('Forbidden'));
    expect((await GET(request(), context)).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.requireGuildAccess).toHaveBeenCalledWith(guildId, 'settings.manage');
  });

  it('paginates by Discord user ID and excludes bots', async () => {
    const page = Array.from({ length: 1000 }, (_, index) => ({ user: { id: String(index + 1).padStart(18, '0'), bot: index === 0 } }));
    mocks.list.mockResolvedValueOnce(page);
    const response = await GET(request(), context);
    const data = await response.json();
    expect(data.members).toHaveLength(999);
    expect(data.nextAfter).toBe(page[999]!.user.id);
    expect(data.revision).toBe(3);
    expect(mocks.list).toHaveBeenCalledWith('token', guildId, 3, undefined);
  });
});
