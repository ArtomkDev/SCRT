import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldPath, FieldValue } from 'firebase-admin/firestore';
import type { GuildRecord } from '@scrt/shared';
import { guildIdSchema, snowflakeSchema, voiceCreatorSchema, voiceInterfaceSchema, voiceRoomSchema, voiceSettingsSchema, type VoiceCreator, type VoiceInterface, type VoiceRoom, type VoiceSettings } from '@scrt/validation';
import type { Firestore } from 'firebase-admin/firestore';

export type FirebaseCredentials = { projectId: string; clientEmail: string; privateKey: string };
export function firestore(credentials: FirebaseCredentials) {
  const app = getApps().find((value) => value.name === 'scrt') ?? initializeApp({ credential: cert({ ...credentials, privateKey: credentials.privateKey.replace(/\\n/g, '\n') }) }, 'scrt');
  return getFirestore(app);
}

export class GuildRepository {
  constructor(private readonly db: ReturnType<typeof firestore>) {}
  async installedGuildIds(guildIds: readonly string[]): Promise<Set<string>> {
    const installed = new Set<string>();
    for (let start = 0; start < guildIds.length; start += 100) {
      const ids = guildIds.slice(start, start + 100);
      const snapshots = await this.db.getAll(...ids.map((id) => this.db.collection('guilds').doc(id)));
      for (const snapshot of snapshots) {
        if (snapshot.get('botInstalled') === true) installed.add(snapshot.id);
      }
    }
    return installed;
  }
  async get(guildId: string): Promise<GuildRecord | null> {
    const snapshot = await this.db.collection('guilds').doc(guildId).get();
    return snapshot.exists ? snapshot.data() as GuildRecord : null;
  }
  watchInstalledGuilds(guildIds: readonly string[], onChange: (kind: 'sync' | 'guilds') => void, onError: (error: Error) => void): () => void {
    const ids = [...new Set(guildIds.map((id) => guildIdSchema.parse(id)))];
    if (ids.length === 0) { onChange('sync'); return () => undefined; }
    const batches = Array.from({ length: Math.ceil(ids.length / 30) }, (_, index) => ids.slice(index * 30, (index + 1) * 30));
    let ready = 0;
    const stops: Array<() => void> = [];
    try {
      for (const batch of batches) {
        let initial = true;
        let previous = '';
        stops.push(this.db.collection('guilds').where(FieldPath.documentId(), 'in', batch).onSnapshot((snapshot) => {
          const current = JSON.stringify(snapshot.docs.map((doc) => [doc.id, doc.get('botInstalled'), doc.get('name'), doc.get('icon')]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
          if (initial) {
            initial = false;
            previous = current;
            if (++ready === batches.length) onChange('sync');
          } else if (current !== previous) { previous = current; onChange('guilds'); }
        }, onError));
      }
    } catch (error) {
      stops.forEach((stop) => stop());
      throw error;
    }
    return () => stops.forEach((stop) => stop());
  }
  async upsertInstalled(guild: Omit<GuildRecord, 'botInstalled' | 'schemaVersion'>): Promise<void> {
    const ref = this.db.collection('guilds').doc(guild.guildId);
    await this.db.runTransaction(async (transaction) => {
      const prior = await transaction.get(ref);
      transaction.set(ref, {
        ...guild, botInstalled: true, schemaVersion: 1,
        updatedAt: FieldValue.serverTimestamp(),
        installedAt: prior.exists && prior.get('installedAt') ? prior.get('installedAt') : FieldValue.serverTimestamp(),
        removedAt: FieldValue.delete(),
      }, { merge: true });
    });
  }
  async markDisconnected(guildId: string): Promise<void> {
    await this.db.collection('guilds').doc(guildId).set({ botInstalled: false, removedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  async signalResourcesChanged(guildId: string): Promise<void> {
    await this.db.collection('guilds').doc(guildIdSchema.parse(guildId)).set({ resourceRevision: FieldValue.increment(1) }, { merge: true });
  }
  async roleMappings(guildId: string): Promise<Array<{ discordRoleId: string; appRole: 'SUPER_ADMIN' | 'ADMIN' | 'VIEWER' }>> {
    const snapshot = await this.db.collection('guilds').doc(guildId).collection('access').doc('roles').get();
    const mappings = snapshot.get('mappings');
    if (!Array.isArray(mappings)) return [];
    return mappings.filter((value): value is { discordRoleId: string; appRole: 'SUPER_ADMIN' | 'ADMIN' | 'VIEWER' } => typeof value === 'object' && value !== null && typeof value.discordRoleId === 'string' && ['SUPER_ADMIN', 'ADMIN', 'VIEWER'].includes(value.appRole));
  }
}

export class VoiceRepository {
  constructor(private readonly db: Firestore) {}
  private root(guildId: string) { return this.db.collection('guilds').doc(guildIdSchema.parse(guildId)); }
  private creators(guildId: string) { return this.root(guildId).collection('voiceCreators'); }
  private rooms(guildId: string) { return this.root(guildId).collection('voiceRooms'); }
  watchDashboard(guildId: string, includeVoice: boolean, onChange: (kind: 'sync' | 'guild' | 'access' | 'rooms' | 'creators' | 'settings' | 'interfaces') => void, onError: (error: Error) => void): () => void {
    const root = this.root(guildId);
    const sources = [
      { kind: 'guild' as const, ref: root },
      { kind: 'access' as const, ref: root.collection('access').doc('roles') },
    ];
    const collections = includeVoice ? [
      { kind: 'rooms' as const, ref: this.rooms(guildId) },
      { kind: 'creators' as const, ref: this.creators(guildId) },
      { kind: 'settings' as const, ref: root.collection('voiceSettings') },
      { kind: 'interfaces' as const, ref: root.collection('voiceInterfaces') },
    ] : [];
    let ready = 0;
    const expected = sources.length + collections.length;
    const initial = () => { if (++ready === expected) onChange('sync'); };
    const stops: Array<() => void> = [];
    try {
      for (const { kind, ref } of sources) {
        let first = true;
        stops.push(ref.onSnapshot(() => {
          if (first) { first = false; initial(); } else onChange(kind);
        }, onError));
      }
      for (const { kind, ref } of collections) {
        let first = true;
        stops.push(ref.onSnapshot((snapshot) => {
          if (first) { first = false; initial(); }
          else if (snapshot.docChanges().length > 0) onChange(kind);
        }, onError));
      }
    } catch (error) {
      stops.forEach((stop) => stop());
      throw error;
    }
    return () => stops.forEach((stop) => stop());
  }
  async getSettings(guildId: string): Promise<VoiceSettings> {
    const doc = await this.root(guildId).collection('voiceSettings').doc('main').get();
    return voiceSettingsSchema.parse(doc.data() ?? {});
  }
  async saveSettings(guildId: string, input: VoiceSettings): Promise<void> {
    const value = voiceSettingsSchema.parse(input);
    await this.root(guildId).collection('voiceSettings').doc('main').set({ ...value, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  async listCreators(guildId: string): Promise<VoiceCreator[]> {
    const docs = await this.creators(guildId).get();
    return docs.docs.flatMap((doc) => { const parsed = voiceCreatorSchema.safeParse(doc.data()); return parsed.success && parsed.data.guildId === guildId && parsed.data.id === doc.id && !parsed.data.archived ? [parsed.data] : []; });
  }
  watchCreators(guildId: string, onChange: (creators: VoiceCreator[]) => void, onError: (error: Error) => void): () => void {
    return this.creators(guildId).onSnapshot((snapshot) => {
      onChange(snapshot.docs.flatMap((doc) => { const parsed = voiceCreatorSchema.safeParse(doc.data()); return parsed.success && parsed.data.guildId === guildId && parsed.data.id === doc.id && !parsed.data.archived ? [parsed.data] : []; }));
    }, onError);
  }
  async getCreator(guildId: string, creatorId: string): Promise<VoiceCreator | null> {
    const doc = await this.creators(guildId).doc(snowflakeSchema.parse(creatorId)).get();
    const parsed = voiceCreatorSchema.safeParse(doc.data());
    return parsed.success && parsed.data.guildId === guildId && parsed.data.id === doc.id ? parsed.data : null;
  }
  async saveCreator(guildId: string, input: VoiceCreator): Promise<void> {
    const value = voiceCreatorSchema.parse(input);
    if (value.guildId !== guildId) throw new Error('Cross-guild creator');
    const ref = this.creators(guildId).doc(value.id);
    const prior = await ref.get();
    await ref.set({ ...value, updatedAt: FieldValue.serverTimestamp(), createdAt: prior.get('createdAt') ?? FieldValue.serverTimestamp() }, { merge: true });
  }
  async disableCreator(guildId: string, creatorId: string): Promise<void> {
    const ref = this.creators(guildId).doc(snowflakeSchema.parse(creatorId));
    await this.db.runTransaction(async (transaction) => {
      if ((await transaction.get(ref)).exists) transaction.update(ref, { enabled: false, updatedAt: FieldValue.serverTimestamp() });
    });
  }
  async deleteCreator(guildId: string, creatorId: string): Promise<void> {
    await this.creators(guildId).doc(snowflakeSchema.parse(creatorId)).update({ enabled: false, archived: true, updatedAt: FieldValue.serverTimestamp() });
  }
  async listInterfaces(guildId: string): Promise<VoiceInterface[]> {
    const docs = await this.root(guildId).collection('voiceInterfaces').get();
    return docs.docs.flatMap((doc) => { const parsed = voiceInterfaceSchema.safeParse(doc.data()); return parsed.success && parsed.data.guildId === guildId && parsed.data.id === doc.id ? [parsed.data] : []; });
  }
  async saveInterface(input: VoiceInterface): Promise<void> {
    const value = voiceInterfaceSchema.parse(input);
    await this.root(value.guildId).collection('voiceInterfaces').doc(value.id).set({ ...value, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  async deleteInterface(guildId: string, id: string): Promise<void> {
    await this.root(guildId).collection('voiceInterfaces').doc(snowflakeSchema.parse(id)).delete();
  }
  async listRooms(guildId: string): Promise<VoiceRoom[]> {
    const docs = await this.rooms(guildId).get();
    return docs.docs.flatMap((doc) => { const parsed = voiceRoomSchema.safeParse(doc.data()); return parsed.success && parsed.data.guildId === guildId && parsed.data.channelId === doc.id ? [parsed.data] : []; });
  }
  async getRoom(guildId: string, channelId: string): Promise<VoiceRoom | null> {
    const doc = await this.rooms(guildId).doc(snowflakeSchema.parse(channelId)).get();
    const parsed = voiceRoomSchema.safeParse(doc.data());
    return parsed.success && parsed.data.guildId === guildId && parsed.data.channelId === doc.id ? parsed.data : null;
  }
  async saveRoom(room: VoiceRoom): Promise<void> {
    const value = voiceRoomSchema.parse(room);
    await this.rooms(value.guildId).doc(value.channelId).set(value);
  }
  async updateRoom(guildId: string, channelId: string, patch: Partial<VoiceRoom>): Promise<void> {
    await this.rooms(guildId).doc(snowflakeSchema.parse(channelId)).update({ ...patch, updatedAt: Date.now() });
  }
  async deleteRoom(guildId: string, channelId: string): Promise<void> {
    await this.rooms(guildId).doc(snowflakeSchema.parse(channelId)).delete();
  }
  async changeOwner(guildId: string, channelId: string, expectedOwner: string | null, nextOwner: string | null): Promise<boolean> {
    const ref = this.rooms(guildId).doc(snowflakeSchema.parse(channelId));
    return this.db.runTransaction(async (transaction) => {
      const doc = await transaction.get(ref);
      if (!doc.exists || doc.get('ownerId') !== expectedOwner || doc.get('state') !== 'active') return false;
      transaction.update(ref, { ownerId: nextOwner, ownerLeftAt: null, updatedAt: Date.now() });
      return true;
    });
  }
  async audit(input: { guildId: string; action: string; actorId?: string | null; targetUserId?: string | null; channelId?: string | null; creatorId?: string | null; source: 'discord' | 'dashboard' | 'recovery' }): Promise<void> {
    await this.root(input.guildId).collection('voiceAudit').add({ ...input, timestamp: FieldValue.serverTimestamp() });
  }
}
