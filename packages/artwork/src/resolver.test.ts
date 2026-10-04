import { describe, expect, it, vi } from 'vitest';
import type { ActivityArtwork, ArtworkAsset, ArtworkSource } from '@scrt/shared';
import { effectiveArtwork } from '@scrt/shared';
import { ActivityArtworkResolver, ARTWORK_TTL, generatedArtwork } from './resolver';
import { BrandArtworkProvider, DiscordArtworkProvider, GeneratedFallbackProvider, SimpleIconsArtworkProvider } from './local-providers';
import { chooseArtworkCandidate } from './matching';
import type { ActivityArtworkProvider, ArtworkProviderResult, ArtworkStore } from './types';

const guildId = '12345678901234567';
const identity = { gameKey: 'name:dota 2', displayName: 'Dota 2', applicationId: null };
const asset = (source: ArtworkSource, kind: ArtworkAsset['kind'] = 'icon'): ArtworkAsset => ({ url: `https://images.example.com/${source}/${kind}.png`, source, kind, entityId: '42', attributionUrl: null });
function provider(id: ArtworkSource, result: ArtworkProviderResult | null): ActivityArtworkProvider {
  return { id, resolve: vi.fn(async () => result), health: () => ({ status: 'available', checkedAt: 0 }) };
}
function store(initial?: ActivityArtwork) {
  const records = new Map<string, ActivityArtwork>(initial ? [[`${guildId}:${identity.gameKey}`, initial]] : []);
  const value: ArtworkStore = { get: vi.fn(async (guild, key) => records.get(`${guild}:${key}`) ?? null), saveResolved: vi.fn(async (guild, artwork) => { records.set(`${guild}:${artwork.gameKey}`, artwork); return artwork; }), saveProviderHealth: vi.fn(async () => undefined) };
  return value;
}
describe('artwork resolution', () => {
  it('invalidates legacy artwork and fresh misses after a provider is connected, preserving manual images', async () => {
    const legacy = generatedArtwork(identity); legacy.nextRefreshAt = Date.now() + ARTWORK_TTL.success;
    legacy.overrides.iconUrl = 'https://images.example.com/manual.png';
    const storage = store(legacy);
    const missing = provider('steamgriddb', null); missing.health = () => ({ status: 'not_configured', checkedAt: 0 });
    const firstResolver = new ActivityArtworkResolver(storage, [missing]);
    expect(firstResolver.needsRefresh(legacy)).toBe(true);
    const first = await firstResolver.resolve(guildId, identity);
    expect(firstResolver.needsRefresh(first)).toBe(false);
    const connected = provider('steamgriddb', { hero: asset('steamgriddb', 'hero'), confidence: 1 });
    const secondResolver = new ActivityArtworkResolver(storage, [connected]);
    expect(secondResolver.needsRefresh(first)).toBe(true);
    const second = await secondResolver.resolve(guildId, identity);
    expect(second.hero?.source).toBe('steamgriddb'); expect(second.overrides.iconUrl).toBe(legacy.overrides.iconUrl); expect(secondResolver.needsRefresh(second)).toBe(false);
  });
  it('keeps manual fields independently while resolving the automatic hero', async () => {
    const cached = generatedArtwork(identity); cached.overrides.iconUrl = 'https://images.example.com/manual.png';
    const automatic = provider('steamgriddb', { icon: asset('steamgriddb'), hero: asset('steamgriddb', 'hero'), confidence: 1 });
    const result = await new ActivityArtworkResolver(store(cached), [automatic]).resolve(guildId, identity);
    expect(effectiveArtwork(result, 'icon')?.source).toBe('manual'); expect(result.hero?.source).toBe('steamgriddb');
  });
  it('honors icon and hero priorities independently and stops once both fields exist', async () => {
    const discord = provider('discord', { icon: asset('discord'), confidence: 1 });
    const steam = provider('steamgriddb', { icon: asset('steamgriddb'), hero: asset('steamgriddb', 'hero'), confidence: 1 });
    const igdb = provider('igdb', { icon: asset('igdb'), hero: asset('igdb', 'hero'), confidence: 1 });
    const result = await new ActivityArtworkResolver(store(), [discord, steam, igdb]).resolve(guildId, identity);
    expect(result.icon?.source).toBe('discord'); expect(result.hero?.source).toBe('steamgriddb'); expect(igdb.resolve).not.toHaveBeenCalled();
  });
  it('combines a Steam hero with a Simple Icons software icon', async () => {
    const result = await new ActivityArtworkResolver(store(), [provider('steamgriddb', { hero: asset('steamgriddb', 'hero'), confidence: 1 }), new SimpleIconsArtworkProvider()]).resolve(guildId, { gameKey: 'name:github', displayName: 'GitHub', applicationId: null });
    expect(result.hero?.source).toBe('steamgriddb'); expect(result.icon?.source).toBe('simple-icons');
  });
  it.each(['steamgriddb', 'igdb'] as const)('uses %s before Simple Icons', async (source) => {
    const result = await new ActivityArtworkResolver(store(), [provider(source, { icon: asset(source), confidence: 1 }), provider('simple-icons', { icon: asset('simple-icons'), confidence: 1 })]).resolve(guildId, identity);
    expect(result.icon?.source).toBe(source);
  });
  it('times out a provider and tries the next provider', async () => {
    const slow = provider('steamgriddb', null); slow.resolve = vi.fn(() => new Promise<ArtworkProviderResult | null>(() => undefined));
    const result = await new ActivityArtworkResolver(store(), [slow, provider('igdb', { icon: asset('igdb'), hero: asset('igdb', 'hero'), confidence: 1 })], 10).resolve(guildId, identity);
    expect(result.icon?.source).toBe('igdb'); expect(result.status).toBe('error'); expect(result.nextRefreshAt - result.resolvedAt).toBe(ARTWORK_TTL.error);
  });
  it('keeps trusted stale images during outages instead of replacing them with lower priority sources', async () => {
    const cached = generatedArtwork(identity); cached.icon = asset('steamgriddb');
    const broken = provider('steamgriddb', null); broken.resolve = vi.fn(async () => { throw new Error('offline'); });
    const result = await new ActivityArtworkResolver(store(cached), [broken, provider('igdb', { icon: asset('igdb'), confidence: 1 })]).resolve(guildId, identity);
    expect(result.icon?.source).toBe('steamgriddb');
  });
  it('negative-caches unknown activities and never repeats the provider chain on fresh reads', async () => {
    const missing = provider('steamgriddb', null); const storage = store(); const resolver = new ActivityArtworkResolver(storage, [missing, new GeneratedFallbackProvider()]);
    const first = await resolver.resolve(guildId, identity); const second = await resolver.resolve(guildId, identity);
    expect(second).toEqual(first); expect(first.nextRefreshAt - first.resolvedAt).toBe(ARTWORK_TTL.notFound); expect(missing.resolve).toHaveBeenCalledOnce();
  });
  it('caches successful artwork for 30 days and keeps new Discord icons above stale failed Steam assets', async () => {
    const cached = generatedArtwork(identity); cached.icon = asset('steamgriddb');
    const broken = provider('steamgriddb', null); broken.resolve = vi.fn(async () => { throw new Error('offline'); });
    const discord = provider('discord', { icon: asset('discord'), confidence: 1 });
    const result = await new ActivityArtworkResolver(store(cached), [discord, broken]).resolve(guildId, identity);
    expect(result.icon?.source).toBe('discord');
    const source = provider('steamgriddb', { icon: asset('steamgriddb'), hero: asset('steamgriddb', 'hero'), confidence: 1 }); const resolver = new ActivityArtworkResolver(store(), [source]);
    const success = await resolver.resolve(guildId, identity); await resolver.resolve(guildId, identity);
    expect(success.nextRefreshAt - success.resolvedAt).toBe(ARTWORK_TTL.success); expect(source.resolve).toHaveBeenCalledOnce();
  });
  it('automatically retries a missing banner after the partial cache expires, preserving a manual icon', async () => {
    const cached = generatedArtwork(identity); cached.overrides.iconUrl = 'https://images.example.com/manual.png';
    const source = provider('steamgriddb', null);
    const resolver = new ActivityArtworkResolver(store(cached), [source]);
    const first = await resolver.resolve(guildId, identity);
    expect(first.nextRefreshAt - first.resolvedAt).toBe(ARTWORK_TTL.incomplete);
    expect(resolver.needsRefresh(first)).toBe(false);
    source.resolve = vi.fn(async () => ({ hero: asset('steamgriddb', 'hero'), confidence: 1 }));
    const now = vi.spyOn(Date, 'now').mockReturnValue(first.nextRefreshAt + 1);
    try {
      expect(resolver.needsRefresh(first)).toBe(true);
      const result = await resolver.resolve(guildId, identity);
      expect(result.hero?.source).toBe('steamgriddb');
      expect(result.overrides.iconUrl).toBe(cached.overrides.iconUrl);
      expect(result.nextRefreshAt - result.resolvedAt).toBe(ARTWORK_TTL.success);
    } finally { now.mockRestore(); }
  });
  it('generates both assets after all external providers fail and accepts software fallback after IGDB errors', async () => {
    const broken = provider('igdb', null); broken.resolve = vi.fn(async () => { throw new Error('unauthorized'); });
    const resolver = new ActivityArtworkResolver(store(), [broken, new SimpleIconsArtworkProvider(), new GeneratedFallbackProvider()]);
    const unknown = await resolver.resolve(guildId, { ...identity, gameKey: 'name:custom', displayName: 'CustomLauncher' });
    expect(unknown.icon).toBeNull(); expect(unknown.hero).toBeNull(); expect(unknown.status).toBe('error');
    const github = await resolver.resolve(guildId, { ...identity, gameKey: 'name:github', displayName: 'GitHub' });
    expect(github.icon?.source).toBe('simple-icons');
  });
  it('deduplicates concurrent guild/key lookups and isolates identical keys in other guilds', async () => {
    const source = provider('steamgriddb', { icon: asset('steamgriddb'), confidence: 1 }); const resolver = new ActivityArtworkResolver(store(), [source]);
    await Promise.all(Array.from({ length: 10 }, () => resolver.resolve(guildId, identity)));
    expect(source.resolve).toHaveBeenCalledOnce();
    await resolver.resolve('22345678901234567', identity); expect(source.resolve).toHaveBeenCalledTimes(2);
  });
  it('refreshes expired cache and bounds concurrent provider chains to two', async () => {
    let active = 0; let maximum = 0;
    const source = provider('steamgriddb', null);
    source.resolve = vi.fn(async () => { active++; maximum = Math.max(maximum, active); await new Promise((done) => setTimeout(done, 5)); active--; return null; });
    const resolver = new ActivityArtworkResolver(store(), [source]);
    await Promise.all(Array.from({ length: 12 }, (_, i) => resolver.resolve(guildId, { ...identity, gameKey: `name:game ${i}` })));
    expect(maximum).toBe(2);
  });
  it('supports Discord asset evidence and falls through without assets', async () => {
    const discord = new DiscordArtworkProvider();
    const result = await new ActivityArtworkResolver(store(), [discord]).resolve(guildId, identity, { discord: { iconUrl: 'https://cdn.discordapp.com/app-assets/123/456.png', heroUrl: null } });
    expect(result.icon?.source).toBe('discord');
    const missing = await new ActivityArtworkResolver(store(), [discord]).resolve(guildId, identity);
    expect(missing.icon).toBeNull(); expect(missing.status).toBe('not_found');
  });
  it('recognizes software aliases and rejects unsafe substring matches', async () => {
    const resolver = new ActivityArtworkResolver(store(), [new SimpleIconsArtworkProvider(), new BrandArtworkProvider()]);
    const vs = await resolver.resolve(guildId, { ...identity, gameKey: 'name:vs code', displayName: 'VS Code' });
    expect(vs.icon?.source).toBe('brand'); expect(vs.hero).toBeNull(); expect(vs.classification).toBe('application');
    const github = await resolver.resolve(guildId, { ...identity, gameKey: 'name:github desktop', displayName: 'GitHub Desktop' });
    expect(github.icon).toBeNull();
  });
});
describe('conservative matching', () => {
  it('accepts exact Dota 2 and explicit CS2 alias', () => {
    expect(chooseArtworkCandidate('Dota 2', [{ id: 1, name: 'Dota 2' }])?.confidence).toBe(1);
    expect(chooseArtworkCandidate('CS2', [{ id: 1, name: 'Counter-Strike 2' }])?.confidence).toBe(0.98);
  });
  it('rejects weak or ambiguous matches and preserves version numbers', () => {
    expect(chooseArtworkCandidate('Dota', [{ id: 1, name: 'Dota 2' }])).toBeNull();
    expect(chooseArtworkCandidate('Dota 2', [{ id: 1, name: 'Dota 2' }, { id: 2, name: 'Dota 2' }])).toBeNull();
    expect(chooseArtworkCandidate('Game 2', [{ id: 1, name: 'Game 3' }])).toBeNull();
    expect(chooseArtworkCandidate('C++', [{ id: 1, name: 'C#' }])).toBeNull();
  });
});
