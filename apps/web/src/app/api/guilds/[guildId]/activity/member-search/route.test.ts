import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ token: vi.fn(), access: vi.fn(), member: vi.fn(), search: vi.fn() }));
vi.mock('@/lib/session', () => ({ accessToken: mocks.token }));
vi.mock('@/lib/guards', () => ({ requireGuildAccess: mocks.access }));
vi.mock('@/lib/server', () => ({ env: () => ({ DISCORD_BOT_TOKEN: 'test-token' }) }));
vi.mock('@scrt/shared', () => ({ log: vi.fn() }));
vi.mock('@scrt/discord', () => ({
  botGuildMember: mocks.member,
  botSearchGuildMembers: mocks.search,
  directoryMember: (_guildId: string, value: { user: { id: string } }) => ({ id: value.user.id }),
  DiscordApiError: class DiscordApiError extends Error { constructor(readonly status: number) { super(`Discord API failed (${status})`); } },
}));
import { DiscordApiError } from '@scrt/discord';
import { GET } from './route';

const guildId = '123456789012345678';
const userId = '223456789012345678';
const context = { params: Promise.resolve({ guildId }) };
const request = (query = userId) => new Request(`http://localhost/api/guilds/${guildId}/activity/member-search?q=${encodeURIComponent(query)}`);

describe('activity exclusion member search', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.token.mockResolvedValue('session'); mocks.access.mockResolvedValue({}); });
  it('requires authentication and activity.manage before contacting Discord', async () => {
    mocks.token.mockResolvedValueOnce(null);
    expect((await GET(request(), context)).status).toBe(401);
    mocks.access.mockRejectedValueOnce(new Error('Forbidden'));
    expect((await GET(request(), context)).status).toBe(403);
    expect(mocks.access).toHaveBeenCalledWith(guildId, 'activity.manage');
    expect(mocks.member).not.toHaveBeenCalled();
  });
  it('returns an empty search result when the ID is absent from this guild', async () => {
    mocks.member.mockRejectedValue(new DiscordApiError(404));
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ members: [] });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('keeps real Discord failures distinguishable from an empty result', async () => {
    mocks.member.mockRejectedValue(new DiscordApiError(503));
    expect((await GET(request(), context)).status).toBe(503);
  });
  it('filters bots and validates queries before contacting Discord', async () => {
    expect((await GET(request('x'), context)).status).toBe(400);
    expect(mocks.search).not.toHaveBeenCalled();
    mocks.search.mockResolvedValue([{ user: { id: userId } }, { user: { id: guildId, bot: true } }]);
    expect(await (await GET(request('artom'), context)).json()).toEqual({ members: [{ id: userId }] });
  });
});
