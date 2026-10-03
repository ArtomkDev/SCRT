import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtworkGallerySource } from '@scrt/shared';
const mocks = vi.hoisted(() => ({ token: vi.fn(), access: vi.fn(), context: vi.fn(), gallery: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/session', () => ({ accessToken: mocks.token }));
vi.mock('@/lib/guards', () => ({ requireGuildAccess: mocks.access }));
vi.mock('@/lib/artwork-gallery', () => ({ artworkGallery: mocks.gallery, artworkGalleryContext: mocks.context }));
vi.mock('@/lib/server', () => ({ env: () => ({ SESSION_SECRET: 'artwork-route-test-session-secret' }) }));
import { GET } from './route';
import { verifyArtworkSelection } from '@/lib/artwork-selection';
const guildId = '12345678901234567'; const gameKey = 'name:valheim';
const context = { identity: { gameKey }, artwork: { revision: 0 } };
const empty: ArtworkGallerySource = { source: 'steamgriddb', status: 'not_found', assets: [], games: [], nextPage: null };
function request(extra: Record<string, string> = {}) {
  return GET(new Request('http://localhost/api/guilds/' + guildId + '/activity/artwork-search?' + new URLSearchParams({ gameKey, source: 'steamgriddb', query: 'Valheim', ...extra })), { params: Promise.resolve({ guildId }) });
}
beforeEach(() => { vi.resetAllMocks(); mocks.token.mockResolvedValue('session'); mocks.access.mockResolvedValue({}); mocks.context.mockResolvedValue(context); mocks.gallery.mockResolvedValue(empty); });
describe('parallel artwork search route', () => {
  it('requires authentication and live guild management before artwork reads', async () => {
    mocks.token.mockResolvedValue(null); expect((await request()).status).toBe(401);
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.context).not.toHaveBeenCalled();
    mocks.token.mockResolvedValue('session'); mocks.access.mockRejectedValue(new Error('Forbidden'));
    expect((await request()).status).toBe(403); expect(mocks.access).toHaveBeenCalledWith(guildId, 'activity.manage');
    expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.gallery).not.toHaveBeenCalled();
  });
  it('rejects injection and unbounded pages before provider work', async () => {
    expect((await request({ entityId: '42; fields *;' })).status).toBe(400);
    expect((await request({ page: '101' })).status).toBe(400);
    expect((await request({ source: 'https://localhost' })).status).toBe(400);
    expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.gallery).not.toHaveBeenCalled();
  });
  it('starts both fields concurrently and streams a signed result before the slower field completes', async () => {
    const pending = new Map<string, (result: ArtworkGallerySource) => void>();
    mocks.gallery.mockImplementation((_guild, _game, _source, field) => new Promise<ArtworkGallerySource>((resolve) => { pending.set(field, resolve); }));
    const response = await request(); expect(mocks.gallery).toHaveBeenCalledTimes(2);
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith(guildId, gameKey);
    expect(mocks.gallery.mock.calls.every((call) => call[7] === context)).toBe(true);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const reader = response.body!.getReader();
    const asset = { url: 'https://cdn2.steamgriddb.com/hero.png', source: 'steamgriddb', kind: 'hero', entityId: '42', attributionUrl: null } as const;
    pending.get('hero')!({ ...empty, status: 'ok', assets: [{ asset, title: 'Valheim', previewUrl: asset.url }] });
    const chunk = await reader.read(); const update = JSON.parse(new TextDecoder().decode(chunk.value));
    expect(update.field).toBe('hero'); expect(chunk.done).toBe(false);
    expect(verifyArtworkSelection('artwork-route-test-session-secret', update.result.assets[0].token, guildId, gameKey, 'hero')).toEqual(asset);
    expect(() => verifyArtworkSelection('artwork-route-test-session-secret', update.result.assets[0].token, guildId, gameKey, 'icon')).toThrow();
    pending.get('icon')!(empty); expect(JSON.parse(new TextDecoder().decode((await reader.read()).value)).field).toBe('icon');
    expect((await reader.read()).done).toBe(true);
  });
  it('retains successful field results when the other field fails', async () => {
    mocks.gallery.mockImplementation(async (_guild, _game, _source, field) => { if (field === 'icon') throw new Error('private provider details'); return empty; });
    const response = await request(); const updates = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    expect(updates).toContainEqual({ field: 'icon', error: 'Не вдалося завершити пошук. Спробуйте ще раз.' });
    expect(updates).toContainEqual({ field: 'hero', result: empty });
  });
});
