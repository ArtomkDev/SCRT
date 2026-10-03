import { FieldPath, FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import type { ActivityArtwork, ArtworkAsset, ArtworkIdentity, ArtworkMapping } from '@scrt/shared';
import { activityArtworkSchema, activityGameKeySchema, artworkAssetSchema, artworkMappingSchema, artworkOverridesSchema, guildIdSchema, snowflakeSchema } from '@scrt/validation';
import { activityKey } from './activity-repository';

export class ActivityArtworkRepository {
  constructor(readonly db: Firestore) {}
  private root(guildId: string) { return this.db.collection('guilds').doc(guildIdSchema.parse(guildId)); }
  private ref(guildId: string, gameKey: string) { return this.root(guildId).collection('activityArtwork').doc(activityKey(activityGameKeySchema.parse(gameKey))); }
  async getMany(guildId: string, keys: readonly string[]): Promise<ActivityArtwork[]> {
    if (keys.length > 100) throw new Error('Artwork batch exceeds 100 identities');
    if (!keys.length) return [];
    const unique = [...new Set(keys)];
    const docs = await this.db.getAll(...unique.map((key) => this.ref(guildId, key)));
    return docs.flatMap((doc, index) => {
      const parsed = activityArtworkSchema.safeParse(doc.data());
      return parsed.success && parsed.data.gameKey === unique[index] ? [parsed.data] : [];
    });
  }
  async get(guildId: string, key: string) { return (await this.getMany(guildId, [key]))[0] ?? null; }
  /** A refresh cannot overwrite a newer admin edit, mapping or captured Discord asset. */
  async saveResolved(guildId: string, artwork: ActivityArtwork, expected: ActivityArtwork | null): Promise<ActivityArtwork | null> {
    const value = activityArtworkSchema.parse(artwork);
    const ref = this.ref(guildId, value.gameKey);
    return this.db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const parsed = activityArtworkSchema.safeParse(doc.data());
      const current = parsed.success ? parsed.data : null;
      if (JSON.stringify(current?.mapping ?? null) !== JSON.stringify(expected?.mapping ?? null)
        || JSON.stringify(current?.discord ?? null) !== JSON.stringify(expected?.discord ?? null)
        || (current?.revision ?? 0) !== (expected?.revision ?? 0)
        || (current?.resolvedAt ?? 0) > (expected?.resolvedAt ?? 0)) return current;
      const next = { ...value, overrides: current?.overrides ?? value.overrides, mapping: current?.mapping ?? value.mapping };
      tx.set(ref, { ...next, updatedAt: FieldValue.serverTimestamp() });
      return next;
    });
  }
  async observed(guildId: string, key: string): Promise<ArtworkIdentity> {
    const doc = await this.root(guildId).collection('activityGames').doc(activityKey(activityGameKeySchema.parse(key))).get();
    if (!doc.exists || doc.get('gameKey') !== key) throw new Error('Активність має належати цьому серверу.');
    return { gameKey: key, displayName: String(doc.get('displayName')), applicationId: typeof doc.get('applicationId') === 'string' ? doc.get('applicationId') as string : null };
  }
  async observedBatch(guildId: string, after: string | null) {
    let query = this.root(guildId).collection('activityGames').orderBy(FieldPath.documentId());
    if (after) {
      if (!/^[a-f0-9]{64}$/u.test(after)) throw new Error('Invalid artwork cursor');
      query = query.startAfter(after);
    }
    const docs = await query.limit(9).get();
    return { identities: docs.docs.slice(0, 8).map((doc): ArtworkIdentity => ({ gameKey: String(doc.get('gameKey')), displayName: String(doc.get('displayName')), applicationId: typeof doc.get('applicationId') === 'string' ? doc.get('applicationId') as string : null })), next: docs.size > 8 ? docs.docs[7]!.id : null };
  }
  async edit(guildId: string, key: string, overrides: ActivityArtwork['overrides'] | undefined, mapping: ArtworkMapping | null, actorId: string, initial: ActivityArtwork): Promise<void> {
    const requested = overrides === undefined ? undefined : artworkOverridesSchema.parse(overrides);
    const confirmed = mapping === null ? null : artworkMappingSchema.parse(mapping);
    snowflakeSchema.parse(actorId);
    const ref = this.ref(guildId, key);
    const gameRef = this.root(guildId).collection('activityGames').doc(activityKey(key));
    await this.db.runTransaction(async (tx) => {
      const [game, doc] = await tx.getAll(gameRef, ref);
      if (!game!.exists || game!.get('gameKey') !== key) throw new Error('Активність має належати цьому серверу.');
      const parsed = activityArtworkSchema.safeParse(doc!.data());
      const prior = parsed.success ? parsed.data : activityArtworkSchema.parse(initial);
      const fields = requested ?? prior.overrides;
      for (const url of [fields.iconUrl, fields.heroUrl]) if (url?.startsWith('/') && !url.startsWith(`/servers/${guildId}/activity/artwork/`)) throw new Error('Зображення має належати цьому серверу.');
      const changedMapping = JSON.stringify(prior.mapping) !== JSON.stringify(confirmed);
      const changedOverrides = JSON.stringify(prior.overrides) !== JSON.stringify(fields);
      const next = activityArtworkSchema.parse({ ...prior, overrides: fields, mapping: confirmed, nextRefreshAt: changedMapping || changedOverrides ? 0 : prior.nextRefreshAt,
        selections: { icon: prior.overrides.iconUrl === fields.iconUrl ? prior.selections?.icon ?? null : null, hero: prior.overrides.heroUrl === fields.heroUrl ? prior.selections?.hero ?? null : null },
        ...(changedMapping ? { icon: null, hero: null, logo: null, cover: null, status: 'not_found', resolvedAt: 0 } : {}), revision: prior.revision + 1 });
      this.removeUnusedUpload(tx, guildId, prior.overrides.iconUrl, fields);
      this.removeUnusedUpload(tx, guildId, prior.overrides.heroUrl, fields);
      tx.set(ref, { ...next, updatedAt: FieldValue.serverTimestamp() });
      tx.create(this.root(guildId).collection('activityAudit').doc(), { action: 'activity.artwork_edited', actorId, gameKey: key, timestamp: FieldValue.serverTimestamp() });
    });
  }
  /** Field-specific atomic edit preserves concurrent changes to the other field. Uploads occupy at most two small documents per game. */
  async setField(guildId: string, key: string, field: 'icon' | 'hero', selection: ArtworkAsset | null, actorId: string, initial: ActivityArtwork, upload?: Buffer) {
    guildIdSchema.parse(guildId); activityGameKeySchema.parse(key); snowflakeSchema.parse(actorId);
    if (field !== 'icon' && field !== 'hero') throw new Error('Невідомий тип зображення.');
    if (upload && (upload.length > 400_000 || upload.length < 12 || upload.toString('ascii', 0, 4) !== 'RIFF' || upload.toString('ascii', 8, 12) !== 'WEBP')) throw new Error('Некоректний файл зображення.');
    const mediaId = upload ? createHash('sha256').update(key).update(field).update(upload).digest('hex') : null;
    const asset = mediaId ? { url: `/servers/${guildId}/activity/artwork/${mediaId}`, source: 'manual', kind: field, entityId: null, attributionUrl: null } satisfies ArtworkAsset : selection === null ? null : artworkAssetSchema.parse(selection);
    if (asset?.url.startsWith('/') && !asset.url.startsWith(`/servers/${guildId}/activity/artwork/`)) throw new Error('Зображення має належати цьому серверу.');
    const ref = this.ref(guildId, key);
    const root = this.root(guildId);
    await this.db.runTransaction(async (tx) => {
      const [game, doc] = await tx.getAll(root.collection('activityGames').doc(activityKey(key)), ref);
      if (!game!.exists || game!.get('gameKey') !== key) throw new Error('Активність має належати цьому серверу.');
      const parsed = activityArtworkSchema.safeParse(doc!.data());
      const prior = parsed.success ? parsed.data : activityArtworkSchema.parse(initial);
      const urlField = field === 'icon' ? 'iconUrl' : 'heroUrl';
      const previousUrl = prior.overrides[urlField];
      const overrides = { ...prior.overrides, [urlField]: asset?.url ?? null };
      const next = activityArtworkSchema.parse({ ...prior, overrides, selections: { ...prior.selections, [field]: asset }, status: overrides.iconUrl || overrides.heroUrl || prior.icon || prior.hero ? 'resolved' : 'not_found', nextRefreshAt: 0, revision: prior.revision + 1 });
      if (mediaId) tx.set(root.collection('activityArtworkUploads').doc(mediaId), { bytes: upload!, gameKey: key, field, createdAt: FieldValue.serverTimestamp() });
      this.removeUnusedUpload(tx, guildId, previousUrl, overrides);
      tx.set(ref, { ...next, updatedAt: FieldValue.serverTimestamp() });
      tx.create(root.collection('activityAudit').doc(), { action: upload ? 'activity.artwork_uploaded' : 'activity.artwork_edited', actorId, gameKey: key, field, timestamp: FieldValue.serverTimestamp() });
    });
  }
  private removeUnusedUpload(tx: Transaction, guildId: string, url: string | null, overrides: ActivityArtwork['overrides']) {
    const prefix = `/servers/${guildId}/activity/artwork/`;
    if (url?.startsWith(prefix) && url !== overrides.iconUrl && url !== overrides.heroUrl) {
      const id = url.slice(prefix.length);
      if (/^[a-f0-9]{64}$/u.test(id)) tx.delete(this.root(guildId).collection('activityArtworkUploads').doc(id));
    }
  }
  async upload(guildId: string, id: string): Promise<Buffer | null> {
    if (!/^[a-f0-9]{64}$/u.test(id)) return null;
    const doc = await this.root(guildId).collection('activityArtworkUploads').doc(id).get();
    const bytes: unknown = doc.get('bytes');
    if (!(bytes instanceof Uint8Array) || bytes.length > 400_000) return null;
    return Buffer.from(bytes);
  }
  async recordRefresh(guildId: string, gameKey: string, actorId: string) {
    await this.observed(guildId, gameKey);
    await this.root(guildId).collection('activityAudit').doc().set({ action: 'activity.artwork_refreshed', actorId: snowflakeSchema.parse(actorId), gameKey, timestamp: FieldValue.serverTimestamp() });
  }
  async providerHealth(guildId: string) {
    const doc = await this.root(guildId).collection('activityArtworkHealth').doc('providers').get();
    return doc.data() ?? {};
  }
  async saveProviderHealth(guildId: string, health: Record<string, { status: string; checkedAt: number }>) {
    await this.root(guildId).collection('activityArtworkHealth').doc('providers').set(health, { merge: true });
  }
}
