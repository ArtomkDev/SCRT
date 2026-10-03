import 'server-only';
import { cache } from 'react';
import { after } from 'next/server';
import type { ArtworkIdentity } from '@scrt/shared';
import { log } from '@scrt/shared';
import { activityGameKeySchema } from '@scrt/validation';
import { requireGuildAccess } from './guards';
import { activityArtworkResolver, activityArtworkStore } from './server';

/** Cache reads only during rendering. All external enrichment runs after the response. */
export const activityArtworks = cache(async (guildId: string, identities: readonly ArtworkIdentity[]) => {
  await requireGuildAccess(guildId, 'activity.view');
  const keys = identities.map((identity) => activityGameKeySchema.parse(identity.gameKey));
  const artwork = await activityArtworkStore().getMany(guildId, keys).catch(() => { log('warn', 'activity-artwork', 'cache.read.failed', { guildId }); return []; });
  const byKey = new Map(artwork.map((item) => [item.gameKey, item]));
  const missing = identities.filter((identity) => activityArtworkNeedsRefresh(byKey.get(identity.gameKey)));
  if (missing.length) after(async () => {
    // Two workers feed the resolver; no page launches a provider request waterfall.
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(2, missing.length) }, async () => {
      while (cursor < missing.length) {
        const identity = missing[cursor++]!;
        await activityArtworkResolver().resolve(guildId, identity).catch(() => { log('warn', 'activity-artwork', 'refresh.failed', { guildId, gameKey: identity.gameKey }); });
      }
    }));
  });
  return artwork;
});
export function activityArtworkNeedsRefresh(artwork: Parameters<ReturnType<typeof activityArtworkResolver>['needsRefresh']>[0]) {
  return activityArtworkResolver().needsRefresh(artwork);
}
export const activityArtworkForKey = cache(async (guildId: string, key: string) => {
  await requireGuildAccess(guildId, 'activity.view');
  activityGameKeySchema.parse(key);
  return activityArtworkStore().get(guildId, key).catch(() => null);
});
export const activityArtworkHealth = cache(async (guildId: string) => {
  await requireGuildAccess(guildId, 'activity.manage');
  const persisted: Record<string, unknown> = await activityArtworkStore().providerHealth(guildId).catch(() => ({}));
  const local = activityArtworkResolver().health();
  return Object.entries(local).map(([id, health]) => {
    const previous = persisted[id];
    const recent = typeof previous === 'object' && previous !== null && 'checkedAt' in previous && typeof previous.checkedAt === 'number' && previous.checkedAt > Date.now() - 86400_000 && 'status' in previous && typeof previous.status === 'string';
    return { id, status: health.status === 'not_configured' ? 'not_configured' : recent ? previous.status as string : health.status };
  });
});
