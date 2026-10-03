import type { ArtworkSource, SignedArtworkGallery } from '@scrt/shared';

// Matches the resolver's provider order; each provider keeps its own ranking.
export const artworkSources = [['discord', 'Discord'], ['steamgriddb', 'SteamGridDB'], ['igdb', 'IGDB'], ['simple-icons', 'Simple Icons'], ['brand', 'Іконки видавців']] as const;
export type GallerySource = typeof artworkSources[number][0];
export type ArtworkField = 'icon' | 'hero';
export type ArtworkCandidate = SignedArtworkGallery['assets'][number];
export type GalleryState = { result?: SignedArtworkGallery; loading: boolean; entityId?: string; unavailable?: boolean };
export type ArtworkResults = Record<ArtworkField, Partial<Record<GallerySource, GalleryState>>>;

export function artworkSourceLabel(source: ArtworkSource) {
  return artworkSources.find(([value]) => value === source)?.[1] ?? (source === 'manual' ? 'Власне зображення' : 'Автоматичний вибір');
}

/** Older galleries encode dimensions in their normalized title. Never show unknown/zero values. */
export function candidateDimensions(candidate: ArtworkCandidate): string | null {
  const dimensions = /(?:^|\s)(\d+)\s*[×x]\s*(\d+)$/u.exec(candidate.title);
  if (!dimensions || Number(dimensions[1]) <= 0 || Number(dimensions[2]) <= 0) return null;
  return `${dimensions[1]} × ${dimensions[2]}`;
}

export function artworkCandidates(results: ArtworkResults, field: ArtworkField, filter: GallerySource | 'all') {
  const seen = new Set<string>();
  return artworkSources.flatMap(([source]) => {
    if (filter !== 'all' && source !== filter) return [];
    return (results[field][source]?.result?.assets ?? []).filter((candidate) => {
      if (seen.has(candidate.asset.url)) return false;
      seen.add(candidate.asset.url);
      return true;
    });
  });
}

const galleryCache = new Map<string, { expiresAt: number; results: ArtworkResults }>();
export function artworkSearchCacheKey(guildId: string, gameKey: string, revision: number, query: string) {
  return JSON.stringify([guildId, gameKey, revision, query]);
}
export function cachedArtworkSearch(key: string): ArtworkResults | undefined {
  const entry = galleryCache.get(key);
  if (!entry) return;
  if (entry.expiresAt > Date.now()) return entry.results;
  galleryCache.delete(key);
}
export function rememberArtworkSearch(key: string, results: ArtworkResults) {
  if (galleryCache.size >= 40) galleryCache.delete(galleryCache.keys().next().value!);
  const unavailable = Object.values(results).some((states) => Object.values(states).some((state) => state.unavailable));
  // Signed selections live for 30 minutes. The editor cache expires well before that.
  galleryCache.set(key, { results, expiresAt: Date.now() + (unavailable ? 30_000 : 5 * 60_000) });
}
