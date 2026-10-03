import 'server-only';
import type { ArtworkGallerySource } from '@scrt/shared';
import { providerGallery, generatedArtwork, type ArtworkLookupInput } from '@scrt/artwork';
import { activityArtworkResolver, activityArtworkStore } from './server';

const cache = new Map<string, { expiresAt: number; result: ArtworkGallerySource }>();
const pending = new Map<string, Promise<ArtworkGallerySource>>();
export async function artworkGalleryContext(guildId: string, gameKey: string) {
  const identity = await activityArtworkStore().observed(guildId, gameKey);
  const artwork = await activityArtworkStore().get(guildId, gameKey) ?? generatedArtwork(identity);
  return { identity, artwork };
}
export async function artworkGallery(guildId: string, gameKey: string, source: string, field: 'icon' | 'hero', query: string | undefined, entityId: string | undefined, page: number, context?: Awaited<ReturnType<typeof artworkGalleryContext>>) {
  const { identity, artwork } = context ?? await artworkGalleryContext(guildId, gameKey);
  const provider = activityArtworkResolver().provider(source);
  if (!provider) throw new Error('Невідоме джерело оформлення.');
  const id = JSON.stringify([guildId, gameKey, source, field, query, entityId, page, artwork.revision, artwork.discord]);
  const cached = cache.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  const existing = pending.get(id);
  if (existing) return existing;
  if (pending.size >= 20) throw new Error('Пошук зайнятий. Спробуйте трохи пізніше.');
  const input: ArtworkLookupInput = { ...identity, displayName: query ?? identity.displayName, discord: artwork.discord, classification: artwork.classification,
    mapping: entityId && (source === 'steamgriddb' || source === 'igdb') ? { provider: source, entityId } : (!query || query === identity.displayName) && artwork.mapping?.provider === source ? artwork.mapping : null,
    needs: { icon: field === 'icon', hero: field === 'hero' } };
  const task = providerGallery(provider, input, field, page).then((result) => {
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(id, { result, expiresAt: Date.now() + (result.status === 'error' ? 30_000 : 5 * 60_000) });
    return result;
  }).finally(() => { pending.delete(id); });
  pending.set(id, task);
  return task;
}
