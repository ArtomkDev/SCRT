import { FieldPath, FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { guildIdSchema, snowflakeSchema, mediaHistoryItemSchema, mediaSettingsSchema, mediaSessionSchema, type MediaHistoryPage, type MediaSettings } from '@scrt/validation';
import type { MediaHistoryItem, MediaSession } from '@scrt/shared';
import { createHash } from 'node:crypto';

export interface MediaStore {
  getSettings(guildId: string): Promise<MediaSettings>;
  saveSettings(guildId: string, settings: MediaSettings, actorId: string): Promise<void>;
  getSession(guildId: string): Promise<MediaSession | null>;
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
    return doc.exists ? mediaSessionSchema.parse(doc.data()) : null;
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
    const items = snapshot.docs.map((doc) => mediaHistoryItemSchema.parse({ ...doc.data(), id: doc.id }));
    const last = items.at(-1);
    return { items, next: items.length === count && last ? { endedAt: last.endedAt, id: last.id } : null };
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
  // Explicit guild favorites; canonical references only, no streams or credentials.
  async saveFavorite(guildId: string, track: MediaHistoryItem['track'], actorId: string): Promise<void> {
    const id = createHash('sha256').update(`${track.provider}:${track.providerItemId}`).digest('hex');
    await this.root(guildId).collection('mediaFavorites').doc(id).set({ provider: track.provider, providerItemId: track.providerItemId, title: track.title, savedBy: actorId, savedAt: FieldValue.serverTimestamp() });
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
