'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { activityGameKeySchema, artworkMappingSchema, artworkOverridesSchema, artworkUrlSchema } from '@scrt/validation';
import { generatedArtwork } from '@scrt/artwork';
import { requireGuildAccess } from '@/lib/guards';
import { activityArtworkResolver, activityArtworkStore, env } from '@/lib/server';
import { artworkGallery } from '@/lib/artwork-gallery';
import { signArtworkSelection, verifyArtworkSelection } from '@/lib/artwork-selection';
import { prepareArtworkUpload } from '@/lib/artwork-upload';

export async function refreshActivityArtwork(guildId: string, form: FormData): Promise<void> {
  const access = await requireGuildAccess(guildId, 'activity.manage');
  const key = activityGameKeySchema.parse(form.get('gameKey'));
  const identity = await activityArtworkStore().observed(guildId, key);
  await activityArtworkStore().recordRefresh(guildId, key, access.user.id);
  await activityArtworkResolver().resolve(guildId, identity, { force: true });
  revalidatePath(`/servers/${guildId}/activity`, 'layout');
}
export async function editActivityArtwork(guildId: string, form: FormData): Promise<void> {
  const access = await requireGuildAccess(guildId, 'activity.manage');
  const key = activityGameKeySchema.parse(form.get('gameKey'));
  const identity = await activityArtworkStore().observed(guildId, key);
  const value = (field: string) => { const input = form.get(field); if (input !== null && typeof input !== 'string') throw new Error('Невідомий формат поля.'); return input?.trim() || null; };
  const overrides = form.get('mode') === 'mapping' ? undefined : artworkOverridesSchema.parse({ iconUrl: value('iconUrl') ? artworkUrlSchema.parse(value('iconUrl')) : null, heroUrl: value('heroUrl') ? artworkUrlSchema.parse(value('heroUrl')) : null });
  const entityId = value('entityId');
  const mapping = entityId ? artworkMappingSchema.parse({ provider: value('provider'), entityId }) : null;
  await activityArtworkStore().edit(guildId, key, overrides, mapping, access.user.id, generatedArtwork(identity));
  revalidatePath(`/servers/${guildId}/activity`, 'layout');
}

const galleryRequestSchema = z.object({
  gameKey: activityGameKeySchema, field: z.enum(['icon', 'hero']), source: z.enum(['discord', 'steamgriddb', 'igdb', 'simple-icons', 'brand']),
  query: z.string().trim().min(1).max(128).optional(), entityId: z.string().regex(/^[1-9]\d{0,11}$/u).optional(), page: z.number().int().min(0).max(100).default(0),
});
export async function findActivityArtwork(guildId: string, request: z.input<typeof galleryRequestSchema>) {
  await requireGuildAccess(guildId, 'activity.manage');
  const input = galleryRequestSchema.parse(request);
  const result = await artworkGallery(guildId, input.gameKey, input.source, input.field, input.query, input.entityId, input.page);
  return { ...result, assets: result.assets.map((candidate) => ({ ...candidate, token: signArtworkSelection(env().SESSION_SECRET, guildId, input.gameKey, input.field, candidate.asset) })) };
}
export async function selectActivityArtwork(guildId: string, form: FormData): Promise<void> {
  const access = await requireGuildAccess(guildId, 'activity.manage');
  const gameKey = activityGameKeySchema.parse(form.get('gameKey'));
  const field = z.enum(['icon', 'hero']).parse(form.get('field'));
  const identity = await activityArtworkStore().observed(guildId, gameKey);
  const mode = z.enum(['candidate', 'url', 'upload', 'automatic']).parse(form.get('mode'));
  let asset = null;
  let upload: Buffer | undefined;
  if (mode === 'candidate') asset = verifyArtworkSelection(env().SESSION_SECRET, z.string().max(50_000).parse(form.get('token')), guildId, gameKey, field);
  if (mode === 'url') asset = { url: artworkUrlSchema.parse(form.get('url')), source: 'manual' as const, kind: field, entityId: null, attributionUrl: null };
  if (mode === 'upload') {
    const file = form.get('file');
    if (!(file instanceof File)) throw new Error('Оберіть файл зображення.');
    upload = await prepareArtworkUpload(file, field);
  }
  await activityArtworkStore().setField(guildId, gameKey, field, asset, access.user.id, generatedArtwork(identity), upload);
  revalidatePath(`/servers/${guildId}/activity`, 'layout');
}
export async function resetActivityArtwork(guildId: string, form: FormData): Promise<void> {
  const access = await requireGuildAccess(guildId, 'activity.manage');
  const key = activityGameKeySchema.parse(form.get('gameKey'));
  const identity = await activityArtworkStore().observed(guildId, key);
  await activityArtworkStore().edit(guildId, key, { iconUrl: null, heroUrl: null }, null, access.user.id, generatedArtwork(identity));
  revalidatePath(`/servers/${guildId}/activity`, 'layout');
}
export async function enrichMissingArtworkBatch(guildId: string, cursor: string | null) {
  await requireGuildAccess(guildId, 'activity.manage');
  const store = activityArtworkStore();
  const page = await store.observedBatch(guildId, cursor);
  const existing = await store.getMany(guildId, page.identities.map((identity) => identity.gameKey));
  const byKey = new Map(existing.map((item) => [item.gameKey, item]));
  const resolver = activityArtworkResolver();
  const eligible = page.identities.filter((identity) => {
    const cached = byKey.get(identity.gameKey);
    if (!cached) return true;
    const missingIcon = !cached.icon && !cached.overrides.iconUrl;
    const missingHero = !cached.hero && !cached.overrides.heroUrl;
    return (missingIcon || missingHero) && resolver.needsRefresh(cached);
  });
  let index = 0;
  let resolved = 0; let fallback = 0; let errors = 0;
  await Promise.all(Array.from({ length: Math.min(2, eligible.length) }, async () => {
    while (index < eligible.length) {
      const identity = eligible[index++]!;
      try {
        const result = await resolver.resolve(guildId, identity);
        if (result.status === 'error') errors++; else if (result.icon || result.hero) resolved++; else fallback++;
      } catch { errors++; }
    }
  }));
  revalidatePath(`/servers/${guildId}/activity`, 'layout');
  return { scanned: page.identities.length, resolved, fallback, errors, skipped: page.identities.length - eligible.length, next: page.next };
}
