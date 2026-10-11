import { FieldPath, FieldValue, Timestamp, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { guildIdSchema, snowflakeSchema, mediaHistoryItemSchema, mediaSettingsSchema, mediaSessionSchema, mediaTrackSchema, mediaFavoriteSchema, mediaFavoriteIdSchema, type MediaFavorite, type MediaHistoryPage, type MediaSettings } from '@scrt/validation';
import { mediaFavoritePlaylistSchema, mediaPlaylistReferenceSchema, mediaPlaylistSchema, type MediaFavoritePlaylist } from '@scrt/validation';
import type { MediaHistoryItem, MediaPlaylist, MediaSession, MediaTrack } from '@scrt/shared';
import { createHash } from 'node:crypto';
import { isRetiredMediaTrack, migrateMediaSession } from './media-legacy';

export interface MediaStore {
  getSettings(guildId: string): Promise<MediaSettings>;
  saveSettings(guildId: string, settings: MediaSettings, actorId: string): Promise<void>;
  getSession(guildId: string): Promise<MediaSession | null>;
  favoriteTracks(guildId: string, ids: string[]): Promise<MediaFavorite[]>;
  receipt(guildId: string, commandId: string): Promise<{ fingerprint: string } | null>;
  checkpoint(session: MediaSession, priorRevision: number | null, history: MediaHistoryItem[], audit: { action: string; actorId: string | null }, receipt?: { commandId: string; fingerprint: string }): Promise<void>;
}
export class MediaRepository implements MediaStore {
  constructor(private readonly db: Firestore) {}
  private root(guildId: string) { return this.db.collection('guilds').doc(guildIdSchema.parse(guildId)); }
  async getSettings(guildId: string): Promise<MediaSettings> {
    const doc = await this.root(guildId).collection('mediaSettings').doc('main').get();
    return mediaSettingsSchema.parse(doc.data() ?? {});
  }
  async saveSettings(guildId: string, settings: MediaSettings, actorId: string): Promise<void> {
    const root = this.root(guildId);
    const batch = this.db.batch();
    batch.set(root.collection('mediaSettings').doc('main'), { ...mediaSettingsSchema.parse(settings), updatedAt: FieldValue.serverTimestamp() });
    batch.set(root.collection('mediaAudit').doc(), { action: 'settings.updated', actorId, at: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 90 * 86400000) });
    await batch.commit();
  }
  async getSession(guildId: string): Promise<MediaSession | null> {
    const doc = await this.root(guildId).collection('mediaState').doc('current').get();
    return doc.exists ? mediaSessionSchema.parse(migrateMediaSession(doc.data() ?? {})) : null;
  }
  async receipt(guildId: string, commandId: string): Promise<{ fingerprint: string } | null> {
    const doc = await this.root(guildId).collection('mediaCommands').doc(commandId).get();
    return doc.exists ? { fingerprint: String(doc.get('fingerprint')) } : null;
  }
  async checkpoint(session: MediaSession, priorRevision: number | null, history: MediaHistoryItem[], audit: { action: string; actorId: string | null }, receipt?: { commandId: string; fingerprint: string }): Promise<void> {
    const value = mediaSessionSchema.parse(session);
    const root = this.root(value.guildId);
    const state = root.collection('mediaState').doc('current');
    // Most controls have no history to expire; avoid an unrelated settings read on every click.
    const retentionDays = history.length ? (await this.getSettings(value.guildId)).historyRetentionDays : 0;
    await this.db.runTransaction(async (transaction) => {
      const previous = await transaction.get(state);
      if ((previous.exists ? previous.get('revision') : null) !== priorRevision) throw new Error('Media state conflict');
      transaction.set(state, { ...value, checkpointAt: FieldValue.serverTimestamp() });
      for (const item of history) transaction.set(root.collection('mediaHistory').doc(item.id), { ...item, expiresAt: Timestamp.fromMillis(item.endedAt + retentionDays * 86400000) });
      transaction.set(root.collection('mediaAudit').doc(), { ...audit, sessionId: value.sessionId, at: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 90 * 86400000) });
      if (receipt) transaction.set(root.collection('mediaCommands').doc(receipt.commandId), { fingerprint: receipt.fingerprint, expiresAt: Timestamp.fromMillis(Date.now() + 86400000) });
    });
  }
  async history(guildId: string, before = Date.now(), limit = 25, beforeId?: string): Promise<MediaHistoryPage> {
    const settings = await this.getSettings(guildId);
    const cutoff = Date.now() - settings.historyRetentionDays * 86400000;
    let query = this.root(guildId).collection('mediaHistory').where('endedAt', '>=', cutoff).orderBy('endedAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
    if (beforeId) query = query.startAfter(before, beforeId);
    else query = query.where('endedAt', '<', before);
    const count = Math.min(50, Math.max(1, limit));
    const snapshot = await query.limit(count).get();
    const rows = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
    const items = rows.filter((row) => !isRetiredMediaTrack('track' in row ? row.track : null)).map((row) => mediaHistoryItemSchema.parse(row));
    const last = snapshot.docs.at(-1);
    // Advance over retired rows too, including pages containing no supported items.
    return { items, next: snapshot.docs.length === count && last ? { endedAt: mediaHistoryItemSchema.shape.endedAt.parse(last.get('endedAt')), id: last.id } : null };
  }
  async deleteHistoryItem(guildId: string, id: string, actorUserId: string): Promise<'deleted' | 'missing' | 'forbidden'> {
    const actor = snowflakeSchema.parse(actorUserId);
    const ref = this.root(guildId).collection('mediaHistory').doc(mediaHistoryItemSchema.shape.id.parse(id));
    return this.db.runTransaction(async (transaction) => {
      const doc = await transaction.get(ref);
      if (!doc.exists) return 'missing';
      if (doc.get('track.requestedByUserId') !== actor) return 'forbidden';
      transaction.delete(ref);
      return 'deleted';
    });
  }
  // Bound every request, including large histories. Membership is rechecked by the
  // web handler for each batch; document ownership is checked inside the transaction.
  async clearOwnHistory(guildId: string, actorUserId: string): Promise<{ deleted: number; more: boolean }> {
    const actor = snowflakeSchema.parse(actorUserId);
    const history = await this.root(guildId).collection('mediaHistory').where('track.requestedByUserId', '==', actor).limit(100).get();
    if (history.empty) return { deleted: 0, more: false };
    const deleted = await this.db.runTransaction(async (transaction) => {
      const documents = await transaction.getAll(...history.docs.map((doc) => doc.ref));
      let count = 0;
      for (const doc of documents) {
        if (doc.exists && doc.get('track.requestedByUserId') === actor) { transaction.delete(doc.ref); count++; }
      }
      return count;
    });
    return { deleted, more: history.size === 100 };
  }
  async pruneHistory(guildId: string): Promise<void> {
    const settings = await this.getSettings(guildId);
    const old = await this.root(guildId).collection('mediaHistory').where('endedAt', '<', Date.now() - settings.historyRetentionDays * 86400000).limit(100).get();
    const batch = this.db.batch();
    old.docs.forEach((doc) => batch.delete(doc.ref));
    if (!old.empty) await batch.commit();
  }
  async favorites(guildId: string, after?: string) {
    let query = this.root(guildId).collection('mediaFavorites').orderBy(FieldPath.documentId());
    if (after) query = query.startAfter(mediaFavoriteIdSchema.parse(after));
    const snapshot = await query.limit(50).get();
    // Old unused saved-reference records lack a full track. Advance past them too.
    const items = snapshot.docs.filter((doc) => doc.get('track')).map((doc) => mediaFavoriteSchema.parse({ ...doc.data(), id: doc.id }));
    return { items, next: snapshot.size === 50 ? snapshot.docs.at(-1)!.id : null };
  }
  async favoriteTracks(guildId: string, ids: string[]): Promise<MediaFavorite[]> {
    if (ids.length > 100) throw new Error('Favorite collection exceeds queue capacity');
    const collection = this.root(guildId).collection('mediaFavorites');
    if (!ids.length) return [];
    const documents = await this.db.getAll(...ids.map((id) => collection.doc(mediaFavoriteIdSchema.parse(id))));
    return documents.filter((doc) => doc.exists).map((doc) => mediaFavoriteSchema.parse({ ...doc.data(), id: doc.id }));
  }
  async setFavorite(guildId: string, reference: Pick<MediaTrack, 'provider' | 'providerItemId'>, actor: { userId: string; name: string }, liked: boolean, input?: MediaTrack): Promise<MediaFavorite | null> {
    const provider = mediaTrackSchema.shape.provider.parse(reference.provider);
    const providerItemId = mediaTrackSchema.shape.providerItemId.parse(reference.providerItemId);
    const id = createHash('sha256').update(JSON.stringify([provider, providerItemId])).digest('hex');
    const ref = this.root(guildId).collection('mediaFavorites').doc(id);
    const track = input ? mediaTrackSchema.parse(input) : null;
    if (liked && (!track || track.provider !== provider || track.providerItemId !== providerItemId)) throw new Error('Favorite reference mismatch');
    return this.setLike(ref, mediaFavoriteSchema, actor, liked, track ? { track } : {});
  }
  async favoritePlaylists(guildId: string, after?: string) {
    let query = this.root(guildId).collection('mediaFavoritePlaylists').orderBy(FieldPath.documentId());
    if (after) query = query.startAfter(mediaFavoriteIdSchema.parse(after));
    const snapshot = await query.limit(50).get();
    return { items: snapshot.docs.map((doc) => mediaFavoritePlaylistSchema.parse({ ...doc.data(), id: doc.id })), next: snapshot.size === 50 ? snapshot.docs.at(-1)!.id : null };
  }
  async setFavoritePlaylist(guildId: string, reference: string, actor: { userId: string; name: string }, liked: boolean, input?: MediaPlaylist): Promise<MediaFavoritePlaylist | null> {
    const canonical = mediaPlaylistReferenceSchema.parse(reference);
    const id = createHash('sha256').update(JSON.stringify(['soundcloud', canonical])).digest('hex');
    const ref = this.root(guildId).collection('mediaFavoritePlaylists').doc(id);
    const playlist = input ? mediaPlaylistSchema.parse(input) : null;
    if (liked && (!playlist || playlist.providerItemId !== canonical)) throw new Error('Favorite playlist reference mismatch');
    return this.setLike(ref, mediaFavoritePlaylistSchema, actor, liked, playlist ? { playlist } : {});
  }
  private async setLike<T extends MediaFavorite | MediaFavoritePlaylist>(ref: DocumentReference, schema: { parse(input: unknown): T }, actor: { userId: string; name: string }, liked: boolean, metadata: Partial<T>): Promise<T | null> {
    const userId = snowflakeSchema.parse(actor.userId); const id = ref.id;
    return this.db.runTransaction(async (transaction) => {
      const doc = await transaction.get(ref);
      const previous = doc.exists ? schema.parse({ ...doc.data(), id }) : null;
      const likes = previous?.likedBy.filter((entry) => entry.userId !== userId) ?? [];
      if (liked) likes.push({ userId, name: actor.name.slice(0, 100) || userId, likedAt: previous?.likedBy.find((entry) => entry.userId === userId)?.likedAt ?? Date.now() });
      if (!likes.length) { if (doc.exists) transaction.delete(ref); return null; }
      const value = schema.parse({ ...previous, ...metadata, id, likedBy: likes, updatedAt: Date.now() });
      transaction.set(ref, { ...value, writtenAt: FieldValue.serverTimestamp() });
      return value;
    });
  }
  async lease(guildId: string, workerId: string, release = false): Promise<boolean> {
    const ref = this.root(guildId).collection('mediaLease').doc('worker');
    return this.db.runTransaction(async (transaction) => {
      const doc = await transaction.get(ref);
      if (release && (!doc.exists || doc.get('workerId') !== workerId)) return false;
      if (doc.exists && doc.get('workerId') !== workerId && doc.get('expiresAt') > Date.now()) return false;
      transaction.set(ref, { workerId, expiresAt: release ? 0 : Date.now() + 60000 });
      return true;
    });
  }
}
