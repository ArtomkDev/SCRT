import { describe, expect, it } from 'vitest';
import type { MediaTrack } from '@scrt/shared';
import { MediaRepository } from './media-repository';
import { activityTestStore } from './activity-test-store';

const guild = '12345678901234567', otherGuild = '22345678901234567';
const first = { userId: '32345678901234567', name: 'First' }, second = { userId: '42345678901234567', name: 'Second' };
const track = (id = 'track'): MediaTrack => ({ provider: 'soundcloud', providerItemId: `https://soundcloud.com/artist/${id}`, title: id, artist: 'Artist', type: 'track', durationMs: 60000, artworkUrl: null, externalUrl: `https://soundcloud.com/artist/${id}`, playable: true, seekable: true, explicit: null });
describe('shared guild favorites', () => {
  it('stores playlist hearts separately, preserves other listeners and scopes every record by guild', async () => {
    const fixture = activityTestStore(); const repo = new MediaRepository(fixture.db);
    const reference = 'https://soundcloud.com/artist/sets/collection';
    const playlist = { provider: 'soundcloud' as const, providerItemId: reference, externalUrl: reference, title: 'Collection', artist: 'Artist', artworkUrl: null, trackCount: 12 };
    const firstLike = (await repo.setFavoritePlaylist(guild, `${reference}?si=share`, first, true, playlist))!;
    expect(await repo.setFavoritePlaylist(guild, reference, first, true, playlist)).toMatchObject({ likedBy: firstLike.likedBy });
    await repo.setFavoritePlaylist(guild, reference, second, true, playlist);
    expect((await repo.setFavoritePlaylist(guild, reference, first, false))?.likedBy.map((entry) => entry.userId)).toEqual([second.userId]);
    expect((await repo.favoritePlaylists(otherGuild)).items).toEqual([]); expect((await repo.favorites(guild)).items).toEqual([]);
    expect((await repo.favoritePlaylists(guild)).items).toHaveLength(1);
    await expect(repo.setFavoritePlaylist(guild, reference, first, true, { ...playlist, providerItemId: 'https://soundcloud.com/artist/sets/other', externalUrl: 'https://soundcloud.com/artist/sets/other' })).rejects.toThrow('mismatch');
    expect(await repo.setFavoritePlaylist(guild, reference, second, false)).toBeNull();
    expect((await repo.favoritePlaylists(guild)).items).toEqual([]);
  });
  it('keeps other users hearts and makes like/unlike idempotent', async () => {
    const fixture = activityTestStore(); const repo = new MediaRepository(fixture.db); const song = track();
    const liked = (await repo.setFavorite(guild, song, first, true, song))!;
    expect(liked.id).toMatch(/^[a-f0-9]{64}$/);
    const repeated = await repo.setFavorite(guild, song, first, true, song);
    expect(repeated?.likedBy).toEqual(liked.likedBy);
    await repo.setFavorite(guild, song, second, true, song);
    const removed = await repo.setFavorite(guild, song, first, false);
    expect(removed?.likedBy.map((like) => like.userId)).toEqual([second.userId]);
    expect(await repo.setFavorite(guild, song, first, false)).toMatchObject({ likedBy: removed!.likedBy });
    expect((await repo.favorites(guild)).items).toHaveLength(1);
    expect(await repo.setFavorite(guild, song, second, false)).toBeNull();
    expect((await repo.favorites(guild)).items).toEqual([]);
    expect(await repo.setFavorite(guild, song, second, false)).toBeNull();
  });
  it('isolates favorites by guild, validates IDs and stores only canonical public track metadata', async () => {
    const fixture = activityTestStore(); const repo = new MediaRepository(fixture.db); const song = track();
    const liked = (await repo.setFavorite(guild, song, first, true, { ...song, streamUrl: 'secret' } as MediaTrack))!;
    expect(await repo.favoriteTracks(otherGuild, [liked.id])).toEqual([]);
    expect((await repo.favorites(otherGuild)).items).toEqual([]);
    expect(await repo.favoriteTracks(guild, [liked.id])).toEqual([liked]);
    expect(JSON.stringify(fixture.records.get(`guilds/${guild}/mediaFavorites/${liked.id}`))).not.toContain('secret');
    await expect(repo.setFavorite(guild, song, first, true, track('different'))).rejects.toThrow('mismatch');
    await expect(repo.favoriteTracks(guild, ['../foreign'])).rejects.toThrow();
    await expect(repo.favoriteTracks(guild, Array(101).fill(liked.id))).rejects.toThrow();
    expect((await repo.favorites(guild)).items).toHaveLength(1);
  });
  it('loads every page without a compound index and advances past legacy records', async () => {
    const fixture = activityTestStore(true); const repo = new MediaRepository(fixture.db);
    for (let i = 0; i < 50; i++) fixture.records.set(`guilds/${guild}/mediaFavorites/${i.toString(16).padStart(64, '0')}`, { savedBy: first.userId });
    await repo.setFavorite(guild, track(), first, true, track());
    const page = await repo.favorites(guild);
    expect(page.items).toEqual([]); expect(page.next).toBeTruthy();
    const next = await repo.favorites(guild, page.next!);
    expect(next.items.map((item) => item.track.title)).toEqual(['track']); expect(next.next).toBeNull();
    expect(fixture.queries.every((query) => query.collection === `guilds/${guild}/mediaFavorites` && query.limit === 50)).toBe(true);
  });
});
