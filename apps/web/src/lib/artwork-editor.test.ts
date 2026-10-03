import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SignedArtworkGallery } from '@scrt/shared';
import { artworkCandidates, artworkSearchCacheKey, cachedArtworkSearch, candidateDimensions, rememberArtworkSearch, type ArtworkResults } from './artwork-editor';

const candidate = (url: string, source: SignedArtworkGallery['source'], title = 'Activity · icon · 512×512'): SignedArtworkGallery['assets'][number] => ({ asset: { url, source, kind: 'icon', entityId: null, attributionUrl: null }, previewUrl: url, title, token: 'signed' });
const gallery = (source: SignedArtworkGallery['source'], assets: SignedArtworkGallery['assets']): SignedArtworkGallery => ({ source, assets, status: 'ok', games: [], nextPage: null });
afterEach(() => vi.useRealTimers());
describe('artwork presentation and cache isolation', () => {
  it('keeps resolver source order, deduplicates URLs, and filters without exposing response structure to React', () => {
    const results: ArtworkResults = { icon: { igdb: { loading: false, result: gallery('igdb', [candidate('shared', 'igdb'), candidate('igdb', 'igdb')]) }, steamgriddb: { loading: false, result: gallery('steamgriddb', [candidate('shared', 'steamgriddb')]) }, discord: { loading: false, result: gallery('discord', [candidate('discord', 'discord')]) } }, hero: {} };
    expect(artworkCandidates(results, 'icon', 'all').map(value => value.asset.url)).toEqual(['discord', 'shared', 'igdb']);
    expect(artworkCandidates(results, 'icon', 'igdb').map(value => value.asset.url)).toEqual(['shared', 'igdb']);
  });
  it('shows only positive, known dimensions', () => {
    expect(candidateDimensions(candidate('image', 'steamgriddb'))).toBe('512 × 512');
    for (const title of ['Activity · icon · 0×0', 'Activity · icon · ?×?', 'Activity · logo', 'Activity · icon · 512×0']) expect(candidateDimensions(candidate('image', 'steamgriddb', title))).toBeNull();
  });
  it('isolates cached signed galleries by guild, activity, revision and query, and expires them before token expiry', () => {
    vi.useFakeTimers();
    const results: ArtworkResults = { icon: {}, hero: {} };
    const key = artworkSearchCacheKey('guild-a', 'activity-a', 1, 'query-a');
    rememberArtworkSearch(key, results);
    expect(cachedArtworkSearch(key)).toBe(results);
    for (const [guild, activity, revision, query] of [['guild-b', 'activity-a', 1, 'query-a'], ['guild-a', 'activity-b', 1, 'query-a'], ['guild-a', 'activity-a', 2, 'query-a'], ['guild-a', 'activity-a', 1, 'query-b']] as const) expect(cachedArtworkSearch(artworkSearchCacheKey(guild, activity, revision, query))).toBeUndefined();
    vi.advanceTimersByTime(5 * 60_000); expect(cachedArtworkSearch(key)).toBeUndefined();
  });
});
