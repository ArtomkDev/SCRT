import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ token: vi.fn(), access: vi.fn(), internal: vi.fn(), favorites: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/guards', () => ({ requireGuildAccess: mocks.access }));
vi.mock('@/lib/session', () => ({ accessToken: mocks.token }));
vi.mock('@/lib/server', () => ({ env: () => ({ NEXT_PUBLIC_APP_URL: 'https://scrt.example' }), media: () => ({ favoritePlaylists: mocks.favorites, setFavoritePlaylist: mocks.save }) }));
vi.mock('@/lib/media-data', () => ({ mediaInternal: mocks.internal, MediaTransportError: class extends Error { constructor(message: string, readonly status: number) { super(message); } } }));
import { GET, POST } from './route';
const guildId = '12345678901234567', userId = '22345678901234567';
const reference = 'https://soundcloud.com/artist/sets/list', context = { params: Promise.resolve({ guildId }) };
const playlist = { provider: 'soundcloud', providerItemId: reference, externalUrl: reference, title: 'List', artist: 'Artist', artworkUrl: null, trackCount: 3 };
const request = (value: unknown, origin = 'https://scrt.example') => new Request('https://scrt.example/favorites/playlists', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(value) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.token.mockResolvedValue('session'); mocks.access.mockResolvedValue({ user: { id: userId, username: 'Listener' } });
  mocks.internal.mockResolvedValue({ playlist, page: 0, entries: [], unavailableCount: 0, nextPage: null });
  mocks.favorites.mockResolvedValue({ items: [], next: null }); mocks.save.mockResolvedValue(null);
});
describe('favorite playlist security', () => {
  it('stores only worker metadata for the signed-in actor in the authorized guild', async () => {
    const response = await POST(request({ providerItemId: `${reference}?si=share`, liked: true }), context);
    expect(response.status).toBe(200);
    expect(mocks.access).toHaveBeenCalledWith(guildId, 'media.view');
    expect(mocks.internal).toHaveBeenCalledWith({ operation: 'playlist', guildId, actorUserId: userId, providerItemId: reference });
    expect(mocks.save).toHaveBeenCalledWith(guildId, reference, { userId, name: 'Listener' }, true, playlist);
  });
  it('can remove own hearts without a running worker and validates pagination', async () => {
    expect((await POST(request({ providerItemId: reference, liked: false }), context)).status).toBe(200);
    expect(mocks.internal).not.toHaveBeenCalled();
    expect((await GET(new Request('https://scrt.example/favorites/playlists?after=../other'), context)).status).toBe(400);
    const cursor = 'a'.repeat(64); await GET(new Request(`https://scrt.example/favorites/playlists?after=${cursor}`), context);
    expect(mocks.favorites).toHaveBeenLastCalledWith(guildId, cursor);
  });
  it('rejects forged metadata, user IDs, private URLs and cross-site mutations before any write', async () => {
    for (const input of [{ providerItemId: reference, liked: true, playlist }, { providerItemId: reference, liked: true, actorUserId: guildId }, { providerItemId: 'http://localhost/list', liked: true }]) expect((await POST(request(input), context)).status).toBe(400);
    expect((await POST(request({ providerItemId: reference, liked: true }, 'https://evil.example'), context)).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.internal).not.toHaveBeenCalled();
    mocks.token.mockResolvedValue(null); expect((await POST(request({ providerItemId: reference, liked: false }), context)).status).toBe(401);
  });
});
