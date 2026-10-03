import { describe, expect, it, vi } from 'vitest';
import { SteamGridDBArtworkProvider, selectSteamAsset } from './steamgriddb';
import { IgdbArtworkProvider } from './igdb';
import { ArtworkHttp } from './http';
import type { ArtworkLookupInput } from './types';

const input: ArtworkLookupInput = { gameKey: 'name:dota 2', displayName: 'Dota 2', applicationId: null, discord: { iconUrl: null, heroUrl: null }, mapping: null, classification: 'unknown', needs: { icon: true, hero: true } };
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
describe('external provider contracts', () => {
  it('decodes JSON when a UTF-8 character spans response chunks', async () => {
    const bytes = new TextEncoder().encode('{"name":"Гра"}');
    let index = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { if (index < bytes.length) controller.enqueue(bytes.subarray(index, ++index)); else controller.close(); } });
    const client = new ArtworkHttp(true, 0, vi.fn<typeof fetch>(async () => new Response(body)));
    await expect(client.json('https://api.example.com', {}, new AbortController().signal)).resolves.toEqual({ name: 'Гра' });
    expect(client.health().status).toBe('ok');
  });
  it('stops an oversized chunked payload, cancels its reader and enters cooldown', async () => {
    const cancel = vi.fn(); let reads = 0;
    const chunk = new TextEncoder().encode('я'.repeat(300_000));
    const body = new ReadableStream<Uint8Array>({ pull(controller) { reads++; controller.enqueue(chunk); }, cancel }, { highWaterMark: 0 });
    const fetcher = vi.fn<typeof fetch>(async () => new Response(body));
    const client = new ArtworkHttp(true, 0, fetcher); const signal = new AbortController().signal;
    await expect(client.json('https://api.example.com', {}, signal)).rejects.toThrow('unavailable');
    expect(reads).toBe(4);
    expect(cancel).toHaveBeenCalledOnce();
    expect(client.health().status).toBe('unavailable');
    await expect(client.json('https://api.example.com', {}, signal)).rejects.toThrow('unavailable');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('rejects a declared oversized response before reading the body', async () => {
    const cancel = vi.fn(); const pull = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
    const client = new ArtworkHttp(true, 0, vi.fn<typeof fetch>(async () => new Response(body, { headers: { 'Content-Length': '2000001' } })));
    await expect(client.json('https://api.example.com', {}, new AbortController().signal)).rejects.toThrow('unavailable');
    expect(pull).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce();
  });
  it('does not send endpoint-incompatible MIME filters that block subsequent hero requests', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      const request = new URL(String(url));
      if (/\/(icons|logos)\//u.test(request.pathname) && request.searchParams.has('mimes')) return new Response(JSON.stringify({ success: false, errors: ['Invalid mime type'] }), { status: 400 });
      return json({ success: true, data: [{ id: 1, url: 'https://cdn2.steamgriddb.com/asset.png', width: request.pathname.includes('/heroes/') ? 3840 : 128, height: 128, mime: 'image/png' }] });
    });
    const provider = new SteamGridDBArtworkProvider('test-key', fetcher);
    const result = await provider.resolve({ ...input, mapping: { provider: 'steamgriddb', entityId: '42' } }, new AbortController().signal);
    expect(result?.failed).toBe(false); expect(result?.icon?.source).toBe('steamgriddb'); expect(result?.hero?.source).toBe('steamgriddb');
    expect(provider.health().status).toBe('ok');
  });
  it('selects official static safe Steam assets and rejects oversized/unsafe/animated heroes', () => {
    const base = { id: 1, url: 'https://cdn2.steamgriddb.com/icon/1.png', width: 128, height: 128, mime: 'image/png' };
    expect(selectSteamAsset([{ ...base, id: 2, style: 'custom', score: 100 }, { ...base, style: 'official' }], 'icon')?.id).toBe(1);
    expect(selectSteamAsset([{ ...base, nsfw: true }, { ...base, humor: true }, { ...base, epilepsy: true }, { ...base, animated: true }], 'icon')).toBeNull();
    expect(selectSteamAsset([{ ...base, width: 3840, height: 2160, mime: 'image/webp', style: ['official'] }], 'hero')?.id).toBe(1);
    expect(selectSteamAsset([{ ...base, width: 10000, height: 2160 }], 'hero')).toBeNull();
  });
  it('reuses a confirmed Steam ID without search and combines icon/logo/hero API results', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => json({ success: true, data: [{ id: 1, url: 'https://cdn2.steamgriddb.com/asset.png', width: String(url).includes('heroes') ? 1280 : 128, height: 128, mime: 'image/png', style: 'official' }] }));
    const provider = new SteamGridDBArtworkProvider('test-key', fetcher);
    const result = await provider.resolve({ ...input, mapping: { provider: 'steamgriddb', entityId: '42' } }, new AbortController().signal);
    expect(result?.hero?.entityId).toBe('42'); expect(fetcher.mock.calls.every(([url]) => String(url).includes('/game/42?'))).toBe(true);
  });
  it('never calls game APIs for recognized software without a confirmed mapping', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await new SteamGridDBArtworkProvider('key', fetcher).resolve({ ...input, classification: 'application' }, new AbortController().signal);
    await new IgdbArtworkProvider('id', 'secret', fetcher).resolve({ ...input, classification: 'application' }, new AbortController().signal);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('deduplicates Twitch tokens, selects game logos before covers and returns 720p artwork', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes('oauth2/token')) return json({ access_token: 'token', expires_in: 3600 });
      if (String(url).endsWith('/logos')) return json([{ image_id: 'logo', animated: false }]);
      return json([{ id: 42, name: 'Dota 2', cover: { image_id: 'cover' }, artworks: [{ image_id: 'hero', width: 1280, height: 720 }], screenshots: [{ image_id: 'screenshot', width: 1280, height: 720 }] }]);
    });
    const provider = new IgdbArtworkProvider('id', 'secret', fetcher);
    const [result] = await Promise.all([provider.resolve(input, new AbortController().signal), provider.resolve(input, new AbortController().signal)]);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('oauth2/token'))).toHaveLength(1);
    expect(result?.icon?.kind).toBe('logo'); expect(result?.hero?.url).toContain('/t_720p/hero.jpg'); expect(result?.cover?.url).toContain('/t_cover_small/');
    expect(String(fetcher.mock.calls[0]?.[0])).not.toContain('secret');
  });
  it('cools down authorization errors without returning credentials', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('', { status: 401 }));
    const provider = new IgdbArtworkProvider('id', 'secret', fetcher);
    await expect(provider.resolve(input, new AbortController().signal)).rejects.toThrow('authorization_error');
    await expect(provider.resolve(input, new AbortController().signal)).rejects.toThrow('authorization_error');
    expect(fetcher).toHaveBeenCalledOnce(); expect(provider.health().status).toBe('authorization_error');
  });
  it('automatically renews a Twitch token near expiry and reuses confirmed IGDB mappings', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const fetcher = vi.fn<typeof fetch>(async (url) => String(url).includes('oauth2/token') ? json({ access_token: 'token', expires_in: 3600 }) : json([{ id: 42, name: 'Dota 2' }]));
      const provider = new IgdbArtworkProvider('id', 'secret', fetcher);
      const confirmed = { ...input, needs: { icon: false, hero: true }, mapping: { provider: 'igdb' as const, entityId: '42' } };
      await provider.resolve(confirmed, new AbortController().signal);
      vi.setSystemTime(Date.now() + 3600_000);
      await provider.resolve(confirmed, new AbortController().signal);
      expect(fetcher.mock.calls.filter(([url]) => String(url).includes('oauth2/token'))).toHaveLength(2);
      const queries = fetcher.mock.calls.filter(([url]) => String(url).endsWith('/games')).map(([, init]) => String(init?.body));
      expect(queries.every((query) => query.includes('where id = 42;') && !query.includes('search'))).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it('respects Retry-After with no aggressive retry', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('', { status: 429, headers: { 'Retry-After': '3600' } }));
    const client = new ArtworkHttp(true, 0, fetcher); const signal = new AbortController().signal;
    await expect(client.json('https://api.example.com', {}, signal)).rejects.toThrow('rate_limited');
    await expect(client.json('https://api.example.com', {}, signal)).rejects.toThrow('rate_limited'); expect(fetcher).toHaveBeenCalledOnce();
  });
});
