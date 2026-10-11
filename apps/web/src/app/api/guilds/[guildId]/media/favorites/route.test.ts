import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ token: vi.fn(), access: vi.fn(), internal: vi.fn(), favorites: vi.fn(), save: vi.fn(), env: { NEXT_PUBLIC_APP_URL: 'https://scrt.example', NODE_ENV: 'development' } }));
vi.mock('@/lib/guards', () => ({ requireGuildAccess: mocks.access }));
vi.mock('@/lib/session', () => ({ accessToken: mocks.token }));
vi.mock('@/lib/server', () => ({ env: () => mocks.env, media: () => ({ favorites: mocks.favorites, setFavorite: mocks.save }) }));
vi.mock('@/lib/media-data', () => ({ mediaInternal: mocks.internal, MediaTransportError: class extends Error { constructor(message: string, readonly status: number) { super(message); } } }));
import { GET, POST } from './route';
const guildId = '12345678901234567', userId = '22345678901234567';
const context = { params: Promise.resolve({ guildId }) };
const track = { provider: 'soundcloud', providerItemId: 'https://soundcloud.com/artist/song', title: 'Song', artist: 'Artist', type: 'track', durationMs: 60000, artworkUrl: null, externalUrl: 'https://soundcloud.com/artist/song', playable: true, seekable: true, explicit: null };
const action = { provider: track.provider, providerItemId: track.providerItemId, liked: true };
const request = (body: unknown, origin = 'https://scrt.example') => new Request('https://scrt.example/favorites', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.env.NODE_ENV = 'development'; mocks.token.mockResolvedValue('session'); mocks.access.mockResolvedValue({ user: { id: userId, username: 'Name', global_name: 'Display name' } }); mocks.internal.mockResolvedValue(track); mocks.save.mockResolvedValue(null); mocks.favorites.mockResolvedValue({ items: [], next: null }); });
describe('favorites authorization and metadata boundary', () => {
  it('uses live guild access, session identity and worker-derived public metadata', async () => {
    const response = await POST(request(action), context);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.access).toHaveBeenCalledExactlyOnceWith(guildId, 'media.view');
    expect(mocks.internal).toHaveBeenCalledExactlyOnceWith({ operation: 'track', guildId, actorUserId: userId, provider: track.provider, providerItemId: track.providerItemId });
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(guildId, action, { userId, name: 'Display name' }, true, track);
  });
  it('can remove only the signed-in user heart without requiring an available worker', async () => {
    const response = await POST(request({ ...action, liked: false }), context);
    expect(response.status).toBe(200); expect(mocks.internal).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(guildId, { ...action, liked: false }, { userId, name: 'Display name' }, false, undefined);
  });
  it('rejects forged identities, client metadata, cross-origin mutations and missing membership', async () => {
    for (const extra of [{ userId: guildId }, { name: 'Forged' }, { track }, { likedBy: [] }]) expect((await POST(request({ ...action, ...extra }), context)).status).toBe(400);
    expect((await POST(request(action, 'https://evil.example'), context)).status).toBe(403);
    mocks.access.mockRejectedValue(new Error('Forbidden'));
    expect((await POST(request(action), context)).status).toBe(403);
    expect((await GET(new Request('https://scrt.example/favorites'), context)).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.internal).not.toHaveBeenCalled(); expect(mocks.favorites).not.toHaveBeenCalled();
    mocks.token.mockResolvedValue(null);
    expect((await POST(request(action), context)).status).toBe(401);
  });
  it('preserves pagination across hidden YouTube favorites in production and forbids new YouTube likes', async () => {
    mocks.env.NODE_ENV = 'production'; const id = 'a'.repeat(64);
    const item = { id, track: { ...track, provider: 'youtube', providerItemId: 'abcdefghijk', externalUrl: 'https://youtube.com/watch?v=abcdefghijk' }, likedBy: [{ userId, name: 'Name', likedAt: 1 }], updatedAt: 1 };
    mocks.favorites.mockResolvedValue({ items: [item], next: id });
    expect(await (await GET(new Request('https://scrt.example/favorites'), context)).json()).toEqual({ items: [], next: id });
    expect((await POST(request({ provider: 'youtube', providerItemId: 'abcdefghijk', liked: true }), context)).status).toBe(422);
    expect(mocks.internal).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
    expect((await GET(new Request('https://scrt.example/favorites?after=../foreign'), context)).status).toBe(400);
    await GET(new Request(`https://scrt.example/favorites?after=${id}`), context);
    expect(mocks.favorites).toHaveBeenLastCalledWith(guildId, id);
  });
});
