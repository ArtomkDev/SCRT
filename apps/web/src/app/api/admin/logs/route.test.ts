import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), env: vi.fn() }));
vi.mock('@/lib/session', () => ({ sessionUser: mocks.user }));
vi.mock('@/lib/server', () => ({ env: mocks.env }));
import { GET } from './route';
beforeEach(() => { mocks.env.mockReturnValue({ MEDIA_BOT_URL: 'http://bot:3100', MEDIA_INTERNAL_SECRET: 'private-secret' }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('Runtime log authorization', () => {
  it.each([null, { id: '12345678901234567' }])('rejects non-admin sessions before contacting the worker', async (user) => {
    mocks.user.mockResolvedValue(user); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const response = await GET(new Request('http://web/api/admin/logs?actorUserId=1409339485904306200'));
    expect(response.status).toBe(user ? 403 : 401); expect(fetch).not.toHaveBeenCalled();
  });
  it('forwards the verified identity and returns uncached process logs without exposing credentials', async () => {
    mocks.user.mockResolvedValue({ id: '1409339485904306200' });
    const fetch = vi.fn().mockResolvedValue(Response.json({ runId: 'bot-run', startedAt: new Date().toISOString(), dropped: 0, entries: [] })); vi.stubGlobal('fetch', fetch);
    const response = await GET(new Request('http://web/api/admin/logs'));
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(fetch.mock.calls[0]![1].headers['X-SCRT-Actor']).toBe('1409339485904306200');
    expect(await response.text()).not.toContain('private-secret');
  });
  it('reports a worker outage without inventing logs or leaking its error', async () => {
    mocks.user.mockResolvedValue({ id: '1409339485904306200' }); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private-secret')));
    const response = await GET(new Request('http://web/api/admin/logs')); const body = await response.json();
    expect(body.bot).toBeNull(); expect(body.botError).toContain('недоступні'); expect(JSON.stringify(body)).not.toContain('private-secret');
  });
});
