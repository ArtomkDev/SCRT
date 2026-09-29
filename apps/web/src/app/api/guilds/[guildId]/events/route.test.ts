import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ accessToken: vi.fn(), requireGuildAccess: vi.fn(), watchDashboard: vi.fn() }));
vi.mock('@/lib/session', () => ({ accessToken: mocks.accessToken }));
vi.mock('@/lib/guards', () => ({ requireGuildAccess: mocks.requireGuildAccess }));
vi.mock('@/lib/server', () => ({ voice: () => ({ watchDashboard: mocks.watchDashboard }) }));
vi.mock('@/lib/live-stream', () => ({ liveStream: (_request: Request, subscribe: (emit: () => void, fail: () => void) => void) => {
  subscribe(() => {}, () => {});
  return new Response(null, { status: 200 });
} }));
vi.mock('@scrt/validation', () => ({ guildIdSchema: { safeParse: (value: string) => /^\d{17,20}$/.test(value) ? { success: true, data: value } : { success: false } } }));

import { GET } from './route';

const guildId = '123456789012345678';
const context = { params: Promise.resolve({ guildId }) };
const request = new Request(`http://localhost/api/guilds/${guildId}/events`);

describe('guild event authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accessToken.mockResolvedValue('token');
    mocks.watchDashboard.mockReturnValue(() => {});
  });

  it('does not subscribe without a session or guild access', async () => {
    mocks.accessToken.mockResolvedValueOnce(null);
    expect((await GET(request, context)).status).toBe(401);
    mocks.requireGuildAccess.mockRejectedValueOnce(new Error('Forbidden'));
    expect((await GET(request, context)).status).toBe(403);
    expect(mocks.watchDashboard).not.toHaveBeenCalled();
  });

  it('subscribes only to the authorized guild and permitted voice data', async () => {
    mocks.requireGuildAccess.mockResolvedValueOnce({ permissions: new Set(['dashboard.access']) });
    expect((await GET(request, context)).status).toBe(200);
    expect(mocks.watchDashboard).toHaveBeenCalledWith(guildId, false, expect.any(Function), expect.any(Function));
  });
});
