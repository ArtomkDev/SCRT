import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), observed: vi.fn(), edit: vi.fn(), field: vi.fn(), record: vi.fn(), resolve: vi.fn(), needsRefresh: vi.fn(), revalidate: vi.fn(), batch: vi.fn(), getMany: vi.fn(), gallery: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/artwork-gallery', () => ({ artworkGallery: mocks.gallery }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/lib/guards', () => ({ requireGuildAccess: mocks.access }));
vi.mock('@/lib/server', () => ({ env: () => ({ SESSION_SECRET: 'test-session-secret-for-artwork-tests' }), activityArtworkStore: () => ({ observed: mocks.observed, edit: mocks.edit, setField: mocks.field, recordRefresh: mocks.record, observedBatch: mocks.batch, getMany: mocks.getMany }), activityArtworkResolver: () => ({ resolve: mocks.resolve, needsRefresh: mocks.needsRefresh }) }));
import { editActivityArtwork, enrichMissingArtworkBatch, refreshActivityArtwork, resetActivityArtwork, findActivityArtwork, selectActivityArtwork } from './artwork-actions';
const guildId = '12345678901234567'; const key = 'name:dota 2';
function form() { const value = new FormData(); value.set('gameKey', key); return value; }
describe('artwork administrator actions', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.needsRefresh.mockImplementation((cached) => !cached || cached.nextRefreshAt <= Date.now()); mocks.access.mockResolvedValue({ user: { id: '22345678901234567' } }); mocks.observed.mockResolvedValue({ gameKey: key, displayName: 'Dota 2', applicationId: null }); mocks.resolve.mockResolvedValue({ status: 'not_found' }); });
  it.each([editActivityArtwork, refreshActivityArtwork, resetActivityArtwork])('requires activity.manage before accessing guild artwork', async (action) => {
    mocks.access.mockRejectedValue(new Error('Forbidden'));
    await expect(action(guildId, form())).rejects.toThrow('Forbidden'); expect(mocks.access).toHaveBeenCalledWith(guildId, 'activity.manage'); expect(mocks.observed).not.toHaveBeenCalled(); expect(mocks.edit).not.toHaveBeenCalled();
  });
  it('rejects an activity absent from the authorized guild before mutation', async () => {
    mocks.observed.mockRejectedValue(new Error('Cross guild'));
    await expect(refreshActivityArtwork(guildId, form())).rejects.toThrow('Cross guild'); expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it('rejects unsafe manual URLs and applies field-specific valid overrides', async () => {
    const bad = form(); bad.set('iconUrl', 'https://127.0.0.1/a');
    await expect(editActivityArtwork(guildId, bad)).rejects.toThrow(); expect(mocks.edit).not.toHaveBeenCalled();
    const good = form(); good.set('iconUrl', 'https://images.example.com/a.png'); await editActivityArtwork(guildId, good);
    expect(mocks.edit.mock.calls[0]?.slice(0, 4)).toEqual([guildId, key, { iconUrl: 'https://images.example.com/a.png', heroUrl: null }, null]);
  });
  it('scans bounded batches, skips manual and fresh negative caches, and reports progress', async () => {
    const identities = ['manual', 'negative', 'new'].map((name) => ({ gameKey: `name:${name}`, displayName: name, applicationId: null }));
    mocks.batch.mockResolvedValue({ identities, next: 'a'.repeat(64) });
    mocks.getMany.mockResolvedValue([{ gameKey: 'name:manual', overrides: { iconUrl: 'https://images.example.com/a.png', heroUrl: 'https://images.example.com/b.png' }, nextRefreshAt: 0 }, { gameKey: 'name:negative', overrides: { iconUrl: null, heroUrl: null }, nextRefreshAt: Date.now() + 60_000 }]);
    const result = await enrichMissingArtworkBatch(guildId, null);
    expect(result).toMatchObject({ scanned: 3, skipped: 2, fallback: 1, next: 'a'.repeat(64) }); expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(guildId, identities[2]);
  });
  it.each(['icon', 'hero'])('fills missing artwork when only the %s is manually overridden', async (field) => {
    const identity = { gameKey: key, displayName: 'Dota 2', applicationId: null };
    mocks.batch.mockResolvedValue({ identities: [identity], next: null });
    mocks.getMany.mockResolvedValue([{ gameKey: key, overrides: { iconUrl: field === 'icon' ? 'https://images.example.com/icon.png' : null, heroUrl: field === 'hero' ? 'https://images.example.com/hero.png' : null }, icon: null, hero: null, nextRefreshAt: 0 }]);
    expect(await enrichMissingArtworkBatch(guildId, null)).toMatchObject({ scanned: 1, skipped: 0, fallback: 1 });
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(guildId, identity);
  });
  it('authorizes both candidate searches and selections before any data or file work', async () => {
    mocks.access.mockRejectedValue(new Error('Forbidden'));
    await expect(findActivityArtwork(guildId, { gameKey: key, field: 'hero', source: 'igdb' })).rejects.toThrow('Forbidden');
    await expect(selectActivityArtwork(guildId, form())).rejects.toThrow('Forbidden');
    expect(mocks.gallery).not.toHaveBeenCalled(); expect(mocks.observed).not.toHaveBeenCalled(); expect(mocks.field).not.toHaveBeenCalled();
  });
  it('saves an independently selected banner and rejects token tampering or field reuse', async () => {
    const asset = { url: 'https://images.igdb.com/hero.jpg', kind: 'hero', source: 'igdb', entityId: '42', attributionUrl: 'https://www.igdb.com' };
    mocks.gallery.mockResolvedValue({ source: 'igdb', status: 'ok', assets: [{ asset, title: 'Dota 2', previewUrl: asset.url }], games: [], nextPage: null });
    const gallery = await findActivityArtwork(guildId, { gameKey: key, field: 'hero', source: 'igdb' });
    const value = form(); value.set('field', 'hero'); value.set('mode', 'candidate'); value.set('token', gallery.assets[0]!.token);
    await selectActivityArtwork(guildId, value);
    expect(mocks.field.mock.calls[0]?.slice(0, 4)).toEqual([guildId, key, 'hero', asset]);
    mocks.field.mockClear(); value.set('field', 'icon');
    await expect(selectActivityArtwork(guildId, value)).rejects.toThrow(); expect(mocks.field).not.toHaveBeenCalled();
  });
  it('validates manual URLs, modes and bounded lookup input', async () => {
    const value = form(); value.set('field', 'icon'); value.set('mode', 'url'); value.set('url', 'https://localhost/icon.png');
    await expect(selectActivityArtwork(guildId, value)).rejects.toThrow(); expect(mocks.field).not.toHaveBeenCalled();
    await expect(findActivityArtwork(guildId, { gameKey: key, field: 'hero', source: 'igdb', entityId: '42; fields *;' })).rejects.toThrow(); expect(mocks.gallery).not.toHaveBeenCalled();
  });
});
