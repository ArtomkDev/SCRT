export * from './activity-repository';
export * from './activity-artwork';
export * from './activity-leaderboards';
export * from './media-repository';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldPath, FieldValue } from 'firebase-admin/firestore';
import type { GuildRecord } from '@scrt/shared';
import { requireAccessGrantEditor, type AccessActor, type AccessGrant, type AccessMappings, type AppRole, type MemberMapping, type RoleMapping } from '@scrt/permissions';
import { directoryChangeSchema, guildIdSchema, snowflakeSchema, voiceCreatorSchema, voiceInterfaceSchema, voiceRoomSchema, voiceSettingsSchema, type DirectoryChange, type DirectoryEvent, type VoiceCreator, type VoiceInterface, type VoiceRoom, type VoiceSettings } from '@scrt/validation';
import type { DocumentSnapshot, Firestore, QuerySnapshot } from 'firebase-admin/firestore';
import { sharedSubscriptions } from './shared-subscriptions';
import { sharedReads } from './shared-reads';

const subscribeDocument = sharedSubscriptions<DocumentSnapshot>();
const subscribeQuery = sharedSubscriptions<QuerySnapshot>();
const readDocument = sharedReads<DocumentSnapshot>();
const readQuery = sharedReads<QuerySnapshot>();

export type FirebaseCredentials = { projectId: string; clientEmail: string; privateKey: string };
export function firestore(credentials: FirebaseCredentials) {
  const app = getApps().find((value) => value.name === 'scrt') ?? initializeApp({ credential: cert({ ...credentials, privateKey: credentials.privateKey.replace(/\\n/g, '\n') }) }, 'scrt');
  return getFirestore(app);
}

function validRoleMappings(value: unknown): RoleMapping[] {
  if (!Array.isArray(value)) return [];
  return value.filter((mapping): mapping is RoleMapping => typeof mapping === 'object' && mapping !== null && snowflakeSchema.safeParse(mapping.discordRoleId).success && ['SUPER_ADMIN', 'ADMIN', 'VIEWER'].includes(mapping.appRole));
}
function validMemberMappings(value: unknown): MemberMapping[] {
  if (!Array.isArray(value)) return [];
  return value.filter((mapping): mapping is MemberMapping => typeof mapping === 'object' && mapping !== null && snowflakeSchema.safeParse(mapping.discordUserId).success && ['SUPER_ADMIN', 'ADMIN', 'VIEWER'].includes(mapping.appRole));
}
function initialAccessRoles(guildId: string, administratorRoleIds: readonly string[], ownerId: string): RoleMapping[] {
  const ids = [...new Set(administratorRoleIds.map((id) => snowflakeSchema.parse(id)))].filter((id) => id !== guildId);
  return [{ discordRoleId: guildId, appRole: 'VIEWER' }, ...ids.map((discordRoleId): RoleMapping => ({ discordRoleId, appRole: 'SUPER_ADMIN', grantedBy: ownerId }))];
}

function requireMappingEditor(guildId: string, actor: AccessActor, snapshot: DocumentSnapshot, grant?: AccessGrant) {
  if (actor.guildId !== guildId) throw new Error('Forbidden');
  snowflakeSchema.parse(actor.userId);
  requireAccessGrantEditor(actor, { roles: validRoleMappings(snapshot.get('mappings')), members: validMemberMappings(snapshot.get('members')) }, grant);
}

function updatedGrant(appRole: AppRole, actor: AccessActor, prior?: AccessGrant): AccessGrant {
  if (!['SUPER_ADMIN', 'ADMIN', 'VIEWER'].includes(appRole)) throw new Error('Invalid access level');
  // A no-op cannot transfer control of an existing grant, including legacy owner-only grants.
  return prior?.appRole === appRole ? { ...prior } : { appRole, grantedBy: actor.userId };
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
    const ref = this.db.collection('guilds').doc(guildIdSchema.parse(guildId));
    const snapshot = await readDocument(this.db, ref.path, () => ref.get());
    return snapshot.exists ? snapshot.data() as GuildRecord : null;
  }
  watchInstalledGuilds(guildIds: readonly string[], onChange: (kind: 'sync' | 'guilds') => void, onError: (error: Error) => void): () => void {
    const ids = [...new Set(guildIds.map((id) => guildIdSchema.parse(id)))].sort();
    if (ids.length === 0) { onChange('sync'); return () => undefined; }
    const batches = Array.from({ length: Math.ceil(ids.length / 30) }, (_, index) => ids.slice(index * 30, (index + 1) * 30));
    let ready = 0;
    const stops: Array<() => void> = [];
    try {
      for (const batch of batches) {
        let initial = true;
        let previous = '';
        const ref = this.db.collection('guilds').where(FieldPath.documentId(), 'in', batch);
        stops.push(subscribeQuery(this.db, `installed:${batch.join(',')}`, (next, fail) => ref.onSnapshot(next, fail), { next: (snapshot) => {
          const current = JSON.stringify(snapshot.docs.map((doc) => [doc.id, doc.get('botInstalled'), doc.get('name'), doc.get('icon')]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
          if (initial) {
            initial = false;
            previous = current;
            if (++ready === batches.length) onChange('sync');
          } else if (current !== previous) { previous = current; onChange('guilds'); }
        }, error: onError }));
      }
    } catch (error) {
      stops.forEach((stop) => stop());
      throw error;
    }
    return () => stops.forEach((stop) => stop());
  }
  async upsertInstalled(guild: Omit<GuildRecord, 'botInstalled' | 'schemaVersion'>, administratorRoleIds: readonly string[] = []): Promise<void> {
    const ref = this.db.collection('guilds').doc(guild.guildId);
    await this.db.runTransaction(async (transaction) => {
      const prior = await transaction.get(ref);
      const access = prior.get('botInstalled') === true ? null : await transaction.get(this.rolesRef(guild.guildId));
      transaction.set(ref, {
        ...guild, botInstalled: true, schemaVersion: 1,
        updatedAt: FieldValue.serverTimestamp(),
        installedAt: prior.exists && prior.get('installedAt') ? prior.get('installedAt') : FieldValue.serverTimestamp(),
        removedAt: FieldValue.delete(),
      }, { merge: true });
      if (access && !access.exists) transaction.set(this.rolesRef(guild.guildId), {
        mappings: initialAccessRoles(guild.guildId, administratorRoleIds, guild.ownerId), members: [], updatedAt: FieldValue.serverTimestamp(),
      });
    });
  }
  async grantInstallerAccess(guildId: string, userId: string, administratorRoleIds: readonly string[], ownerId: string): Promise<void> {
    const id = guildIdSchema.parse(guildId);
    const installerId = snowflakeSchema.parse(userId);
    const owner = snowflakeSchema.parse(ownerId);
    const ref = this.rolesRef(id);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const members = validMemberMappings(snapshot.get('members')).filter((member) => member.discordUserId !== owner);
      const prior = members.find((member) => member.discordUserId === installerId);
      const next = installerId === owner ? members : [...members.filter((member) => member.discordUserId !== installerId), prior?.appRole === 'SUPER_ADMIN' ? prior : { discordUserId: installerId, appRole: 'SUPER_ADMIN' as const, grantedBy: owner }];
      if (next.length > 30) throw new Error('Too many access members');
      transaction.set(ref, {
        ...(!snapshot.exists ? { mappings: initialAccessRoles(id, administratorRoleIds, owner) } : {}),
        members: next, updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
  }
  async markDisconnected(guildId: string): Promise<void> {
    await this.db.collection('guilds').doc(guildId).set({ botInstalled: false, removedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  async signalResourcesChanged(guildId: string): Promise<void> {
    await this.db.collection('guilds').doc(guildIdSchema.parse(guildId)).set({ resourceRevision: FieldValue.increment(1) }, { merge: true });
  }
  private directoryRef(guildId: string) { return this.db.collection('guilds').doc(guildIdSchema.parse(guildId)).collection('directory').doc('state'); }
  async memberDirectoryRevision(guildId: string): Promise<number> {
    const ref = this.directoryRef(guildId);
    const revision = (await readDocument(this.db, ref.path, () => ref.get())).get('revision');
    return typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
  }
  async signalMemberChange(guildId: string, input: DirectoryChange): Promise<void> {
    const change = directoryChangeSchema.parse(input);
    await this.directoryRef(guildId).set({ revision: FieldValue.increment(1), change, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  watchMemberChanges(guildId: string, onChange: (event: DirectoryEvent) => void, onError: (error: Error) => void): () => void {
    let initial = true;
    const ref = this.directoryRef(guildId);
    return subscribeDocument(this.db, ref.path, (next, fail) => ref.onSnapshot(next, fail), { next: (snapshot) => {
      const value = snapshot.get('revision');
      const revision = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
      if (initial) { initial = false; onChange({ kind: 'sync', revision }); return; }
      const parsed = directoryChangeSchema.safeParse(snapshot.get('change'));
      onChange(parsed.success ? { kind: 'change', revision, change: parsed.data } : { kind: 'reset', revision });
    }, error: onError });
  }
  private rolesRef(guildId: string) { return this.db.collection('guilds').doc(guildIdSchema.parse(guildId)).collection('access').doc('roles'); }
  async accessMappings(guildId: string): Promise<AccessMappings> {
    const ref = this.rolesRef(guildId);
    const snapshot = await readDocument(this.db, ref.path, () => ref.get());
    const roles = validRoleMappings(snapshot.get('mappings')).map((mapping) => mapping.discordRoleId === guildId ? { ...mapping, appRole: 'VIEWER' as const } : mapping);
    return { roles, members: validMemberMappings(snapshot.get('members')) };
  }
  async setRoleMapping(guildId: string, discordRoleId: string, appRole: AppRole, actor: AccessActor): Promise<void> {
    const roleId = snowflakeSchema.parse(discordRoleId);
    if (roleId === guildId && appRole !== 'VIEWER') throw new Error('@everyone supports viewing only');
    const ref = this.rolesRef(guildId);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const mappings = validRoleMappings(snapshot.get('mappings'));
      const prior = mappings.find((mapping) => mapping.discordRoleId === roleId);
      requireMappingEditor(guildId, actor, snapshot, prior);
      const next = [...mappings.filter((mapping) => mapping.discordRoleId !== roleId), { ...updatedGrant(appRole, actor, prior), discordRoleId: roleId }];
      if (next.length > 250) throw new Error('Too many access roles');
      transaction.set(ref, { mappings: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
  }
  async removeRoleMapping(guildId: string, discordRoleId: string, actor: AccessActor): Promise<void> {
    const roleId = snowflakeSchema.parse(discordRoleId);
    const ref = this.rolesRef(guildId);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const mappings = validRoleMappings(snapshot.get('mappings'));
      requireMappingEditor(guildId, actor, snapshot, mappings.find((mapping) => mapping.discordRoleId === roleId));
      transaction.set(ref, { mappings: mappings.filter((mapping) => mapping.discordRoleId !== roleId), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
  }
  async setMemberMapping(guildId: string, discordUserId: string, appRole: AppRole, actor: AccessActor): Promise<void> {
    const userId = snowflakeSchema.parse(discordUserId);
    const ref = this.rolesRef(guildId);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const members = validMemberMappings(snapshot.get('members'));
      const prior = members.find((mapping) => mapping.discordUserId === userId);
      requireMappingEditor(guildId, actor, snapshot, prior);
      const next = [...members.filter((mapping) => mapping.discordUserId !== userId), { ...updatedGrant(appRole, actor, prior), discordUserId: userId }];
      if (next.length > 30) throw new Error('Too many access members');
      transaction.set(ref, { members: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
  }
  async removeMemberMapping(guildId: string, discordUserId: string, actor: AccessActor): Promise<void> {
    const userId = snowflakeSchema.parse(discordUserId);
    const ref = this.rolesRef(guildId);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const members = validMemberMappings(snapshot.get('members'));
      requireMappingEditor(guildId, actor, snapshot, members.find((mapping) => mapping.discordUserId === userId));
      transaction.set(ref, { members: members.filter((mapping) => mapping.discordUserId !== userId), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
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
      { kind: 'settings' as const, ref: root.collection('mediaSettings').doc('main') },
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
        stops.push(subscribeDocument(this.db, ref.path, (next, fail) => ref.onSnapshot(next, fail), { next: () => {
          if (first) { first = false; initial(); } else onChange(kind);
        }, error: onError }));
      }
      for (const { kind, ref } of collections) {
        let first = true;
        stops.push(subscribeQuery(this.db, ref.path, (next, fail) => ref.onSnapshot(next, fail), { next: (snapshot) => {
          if (first) { first = false; initial(); }
          else if (snapshot.docChanges().length > 0) onChange(kind);
        }, error: onError }));
      }
    } catch (error) {
      stops.forEach((stop) => stop());
      throw error;
    }
    return () => stops.forEach((stop) => stop());
  }
  async getSettings(guildId: string): Promise<VoiceSettings> {
    const ref = this.root(guildId).collection('voiceSettings').doc('main');
    const doc = await readDocument(this.db, ref.path, () => ref.get());
    return voiceSettingsSchema.parse(doc.data() ?? {});
  }
  async saveSettings(guildId: string, input: VoiceSettings): Promise<void> {
    const value = voiceSettingsSchema.parse(input);
    await this.root(guildId).collection('voiceSettings').doc('main').set({ ...value, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  async listCreators(guildId: string): Promise<VoiceCreator[]> {
    const ref = this.creators(guildId);
    const docs = await readQuery(this.db, ref.path, () => ref.get());
    return docs.docs.flatMap((doc) => { const parsed = voiceCreatorSchema.safeParse(doc.data()); return parsed.success && parsed.data.guildId === guildId && parsed.data.id === doc.id && !parsed.data.archived ? [parsed.data] : []; });
  }
  watchCreators(guildId: string, onChange: (creators: VoiceCreator[]) => void, onError: (error: Error) => void): () => void {
    const ref = this.creators(guildId);
    return subscribeQuery(this.db, ref.path, (next, fail) => ref.onSnapshot(next, fail), { next: (snapshot) => {
      onChange(snapshot.docs.flatMap((doc) => { const parsed = voiceCreatorSchema.safeParse(doc.data()); return parsed.success && parsed.data.guildId === guildId && parsed.data.id === doc.id && !parsed.data.archived ? [parsed.data] : []; }));
    }, error: onError });
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
    const ref = this.root(guildId).collection('voiceInterfaces');
    const docs = await readQuery(this.db, ref.path, () => ref.get());
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
    const ref = this.rooms(guildId);
    const docs = await readQuery(this.db, ref.path, () => ref.get());
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
    await this.root(input.guildId).collection('voiceAudit').add({
      ...input,
      actorId: input.actorId ?? null,
      targetUserId: input.targetUserId ?? null,
      channelId: input.channelId ?? null,
      creatorId: input.creatorId ?? null,
      timestamp: FieldValue.serverTimestamp(),
    });
  }
}
