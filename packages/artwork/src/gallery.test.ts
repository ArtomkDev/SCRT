import { describe, expect, it, vi } from 'vitest';
import { providerGallery } from './gallery';
import { SteamGridDBArtworkProvider } from './steamgriddb';
import { IgdbArtworkProvider } from './igdb';
import { SimpleIconsArtworkProvider } from './local-providers';
import type { ArtworkLookupInput } from './types';

const input: ArtworkLookupInput = { gameKey: 'name:valheim', displayName: 'Valheim', applicationId: null, discord: { iconUrl: null, heroUrl: null }, mapping: null, classification: 'unknown', needs: { icon: false, hero: true } };
const json = (value: unknown) => new Response(JSON.stringify(value));
describe('explicit multi-source galleries', () => {
  it('searches Steam and IGDB game metadata once for concurrent icon/banner galleries', async () => {
    const steamFetch = vi.fn<typeof fetch>(async (url) => json({ success: true, data: String(url).includes('autocomplete') ? [{ id: 42, name: 'Valheim' }] : [] }));
    const steam = new SteamGridDBArtworkProvider('key', steamFetch);
    await Promise.all([providerGallery(steam, input, 'icon'), providerGallery(steam, input, 'hero')]);
    expect(steamFetch.mock.calls.filter(([url]) => String(url).includes('autocomplete'))).toHaveLength(1);
    const igdbFetch = vi.fn<typeof fetch>(async (url) => String(url).includes('oauth2/token') ? json({ access_token: 'token', expires_in: 3600 }) : String(url).endsWith('/games') ? json([{ id: 42, name: 'Valheim' }]) : json([]));
    const igdb = new IgdbArtworkProvider('id', 'secret', igdbFetch);
    await Promise.all([providerGallery(igdb, input, 'icon'), providerGallery(igdb, input, 'hero')]);
    expect(igdbFetch.mock.calls.filter(([url]) => String(url).endsWith('/games'))).toHaveLength(1);
    expect(igdbFetch.mock.calls.filter(([url]) => String(url).includes('oauth2/token'))).toHaveLength(1);
  });
  it('lists every static Steam hero including 3840px and paginates until empty', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes('autocomplete')) return json({ success: true, data: [{ id: 42, name: 'Valheim' }] });
      if (String(url).includes('page=1')) return json({ success: true, data: [] });
      return json({ success: true, data: [1, 2, 3].map((id) => ({ id, url: `https://cdn2.steamgriddb.com/hero/${id}.webp`, thumb: `https://cdn2.steamgriddb.com/thumb/${id}.webp`, width: 3840, height: 1240, style: ['official'], mime: 'image/webp', nsfw: id === 3 })) });
    });
    const provider = new SteamGridDBArtworkProvider('key', fetcher);
    const first = await providerGallery(provider, input, 'hero');
    expect(first.status).toBe('ok'); expect(first.assets).toHaveLength(2); expect(first.nextPage).toBe(1); expect(first.assets[0]?.previewUrl).toContain('/thumb/');
    expect((await providerGallery(provider, input, 'hero', 1)).nextPage).toBeNull();
  });
  it('requires an explicit game choice for ambiguous names and queries that numeric ID', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => json({ success: true, data: String(url).includes('autocomplete') ? [{ id: 42, name: 'A different game' }] : [] }));
    const provider = new SteamGridDBArtworkProvider('key', fetcher);
    const result = await providerGallery(provider, input, 'hero');
    expect(result.status).toBe('not_found'); expect(result.games[0]?.id).toBe('42'); expect(fetcher).toHaveBeenCalledOnce();
    await providerGallery(provider, { ...input, classification: 'application', mapping: { provider: 'steamgriddb', entityId: '42' } }, 'hero');
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('/heroes/game/42?');
  });
  it('returns all IGDB artwork and screenshots, then both cover and logos for icons', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes('oauth2/token')) return json({ access_token: 'token', expires_in: 3600 });
      if (String(url).endsWith('/logos')) return json([{ image_id: 'logo1' }, { image_id: 'logo2' }]);
      return json([{ id: 42, name: 'Valheim', cover: { image_id: 'cover' }, artworks: [{ image_id: 'a1', width: 1280, height: 720 }, { image_id: 'a2', width: 3840, height: 2160 }], screenshots: [{ image_id: 's1', width: 1280, height: 720 }] }]);
    });
    const provider = new IgdbArtworkProvider('id', 'secret', fetcher);
    expect((await providerGallery(provider, input, 'hero')).assets).toHaveLength(3);
    expect((await providerGallery(provider, input, 'icon')).assets.map((item) => item.asset.kind)).toEqual(['cover', 'logo', 'logo']);
  });
  it('distinguishes empty, disconnected and failed sources while retaining partial assets', async () => {
    expect((await providerGallery(new SteamGridDBArtworkProvider(), input, 'hero')).status).toBe('not_configured');
    expect((await providerGallery(new SimpleIconsArtworkProvider(), input, 'hero')).status).toBe('not_found');
    const provider = new SteamGridDBArtworkProvider('key', vi.fn<typeof fetch>(async () => new Response('', { status: 401 })));
    expect((await providerGallery(provider, input, 'hero')).status).toBe('error');
    const partial = { id: 'igdb' as const, health: () => ({ status: 'available' as const, checkedAt: 0 }), resolve: async () => ({ confidence: 1, failed: true, hero: { url: 'https://images.igdb.com/banner.jpg', source: 'igdb' as const, kind: 'hero' as const, entityId: '42', attributionUrl: null } }) };
    const result = await providerGallery(partial, input, 'hero'); expect(result.status).toBe('error'); expect(result.assets).toHaveLength(1);
  });
});
