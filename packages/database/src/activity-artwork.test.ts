import { describe, expect, it } from 'vitest';
import type { ActivityArtwork } from '@scrt/shared';
import { ActivityArtworkRepository } from './activity-artwork';
import { activityKey } from './activity-repository';
import { activityTestStore } from './activity-test-store';
const guildId = '12345678901234567'; const otherGuild = '32345678901234567'; const actorId = '22345678901234567'; const key = 'name:dota 2';
function artwork(): ActivityArtwork { return { gameKey: key, observedName: 'Dota 2', classification: 'unknown', icon: null, logo: null, hero: null, cover: null, dominantColor: null, resolvedName: null, confidence: 0, status: 'not_found', resolvedAt: 0, nextRefreshAt: 0, overrides: { iconUrl: null, heroUrl: null }, mapping: null, discord: { iconUrl: null, heroUrl: null }, schemaVersion: 1, revision: 0 }; }
describe('guild artwork persistence', () => {
  it('preserves the other selected field, stores provenance and cleans replaced uploads', async () => {
    const store = activityTestStore(); const repo = new ActivityArtworkRepository(store.db);
    const game = { gameKey: key, displayName: 'Dota 2', totalSeconds: 100 };
    store.records.set(`guilds/${guildId}/activityGames/${activityKey(key)}`, game);
    const bytes = Buffer.from('RIFF1234WEBPfake');
    await repo.setField(guildId, key, 'icon', null, actorId, artwork(), bytes);
    const iconUrl = (await repo.get(guildId, key))!.overrides.iconUrl!;
    const banner = { url: 'https://images.igdb.com/banner.jpg', source: 'igdb' as const, kind: 'hero' as const, entityId: '42', attributionUrl: 'https://www.igdb.com' };
    await repo.setField(guildId, key, 'hero', banner, actorId, artwork());
    expect((await repo.get(guildId, key))?.overrides.iconUrl).toBe(iconUrl);
    expect((await repo.get(guildId, key))?.selections?.hero).toEqual(banner);
    expect(await repo.upload(guildId, iconUrl.split('/').at(-1)!)).toEqual(bytes);
    expect(await repo.upload(otherGuild, iconUrl.split('/').at(-1)!)).toBeNull();
    await repo.setField(guildId, key, 'icon', null, actorId, artwork());
    expect(await repo.upload(guildId, iconUrl.split('/').at(-1)!)).toBeNull();
    expect((await repo.get(guildId, key))?.overrides.heroUrl).toBe(banner.url);
    expect(store.records.get(`guilds/${guildId}/activityGames/${activityKey(key)}`)).toEqual(game);
  });
  it('preserves uploaded fields when confirming an ID and removes them on reset', async () => {
    const store = activityTestStore(); const repo = new ActivityArtworkRepository(store.db);
    store.records.set(`guilds/${guildId}/activityGames/${activityKey(key)}`, { gameKey: key, displayName: 'Dota 2' });
    await repo.setField(guildId, key, 'hero', null, actorId, artwork(), Buffer.from('RIFF1234WEBPfake'));
    const uploaded = (await repo.get(guildId, key))!.overrides.heroUrl!;
    await repo.edit(guildId, key, undefined, { provider: 'steamgriddb', entityId: '42' }, actorId, artwork());
    expect((await repo.get(guildId, key))?.overrides.heroUrl).toBe(uploaded);
    await repo.edit(guildId, key, { iconUrl: null, heroUrl: null }, null, actorId, artwork());
    expect(await repo.upload(guildId, uploaded.split('/').at(-1)!)).toBeNull();
  });
  it('rejects cross-guild uploads, unsafe paths and oversized binaries without storing anything', async () => {
    const store = activityTestStore(); const repo = new ActivityArtworkRepository(store.db);
    store.records.set(`guilds/${guildId}/activityGames/${activityKey(key)}`, { gameKey: key, displayName: 'Dota 2' });
    await expect(repo.setField(otherGuild, key, 'icon', null, actorId, artwork(), Buffer.from('RIFF1234WEBPfake'))).rejects.toThrow();
    await expect(repo.setField(guildId, key, 'icon', { url: `/servers/${otherGuild}/activity/artwork/${'a'.repeat(64)}`, source: 'manual', kind: 'icon', entityId: null, attributionUrl: null }, actorId, artwork())).rejects.toThrow();
    await expect(repo.setField(guildId, key, 'hero', null, actorId, artwork(), Buffer.alloc(400_001))).rejects.toThrow();
    expect([...store.records.keys()].filter((path) => path.includes('activityArtwork'))).toHaveLength(0);
  });
  it('batch-reads once and isolates the same identity across guilds', async () => {
    const store = activityTestStore(); const repo = new ActivityArtworkRepository(store.db);
    await repo.saveResolved(guildId, artwork(), null);
    expect(await repo.getMany(guildId, [key, key])).toHaveLength(1); expect(store.batches.at(-1)).toBe(1);
    expect(await repo.get(otherGuild, key)).toBeNull();
  });
  it('rejects cross-guild admin writes and does not mutate activity statistics', async () => {
    const store = activityTestStore(); const repo = new ActivityArtworkRepository(store.db);
    const game = { gameKey: key, displayName: 'Dota 2', applicationId: null, totalSeconds: 100, sessionCount: 2 };
    store.records.set(`guilds/${guildId}/activityGames/${activityKey(key)}`, game);
    await expect(repo.edit(otherGuild, key, { iconUrl: 'https://images.example.com/a.png', heroUrl: null }, null, actorId, artwork())).rejects.toThrow();
    await repo.edit(guildId, key, { iconUrl: 'https://images.example.com/a.png', heroUrl: null }, null, actorId, artwork());
    expect(store.records.get(`guilds/${guildId}/activityGames/${activityKey(key)}`)).toEqual(game);
  });
  it('does not overwrite an administrator mapping changed during provider resolution', async () => {
    const store = activityTestStore(); const repo = new ActivityArtworkRepository(store.db);
    store.records.set(`guilds/${guildId}/activityGames/${activityKey(key)}`, { gameKey: key, displayName: 'Dota 2' });
    await repo.saveResolved(guildId, artwork(), null);
    const before = await repo.get(guildId, key);
    await repo.edit(guildId, key, { iconUrl: 'https://images.example.com/manual.png', heroUrl: null }, { provider: 'steamgriddb', entityId: '42' }, actorId, artwork());
    await repo.saveResolved(guildId, { ...artwork(), resolvedAt: Date.now() }, before);
    const current = await repo.get(guildId, key);
    expect(current?.mapping?.entityId).toBe('42'); expect(current?.overrides.iconUrl).toContain('manual.png');
  });
  it('invalidates cache when an administrator clears a manual field', async () => {
    const store = activityTestStore(); const repo = new ActivityArtworkRepository(store.db);
    store.records.set(`guilds/${guildId}/activityGames/${activityKey(key)}`, { gameKey: key, displayName: 'Dota 2' });
    const initial = { ...artwork(), nextRefreshAt: Date.now() + 86400_000, overrides: { iconUrl: 'https://images.example.com/manual.png', heroUrl: null } };
    await repo.saveResolved(guildId, initial, null);
    await repo.edit(guildId, key, { iconUrl: null, heroUrl: null }, null, actorId, artwork());
    expect((await repo.get(guildId, key))?.nextRefreshAt).toBe(0);
  });
});
